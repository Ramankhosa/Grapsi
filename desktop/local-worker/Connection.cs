using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Grapsi.LocalWorker {
  internal sealed class Connection : IDisposable {
    Process process;ChildGroup children;
    readonly ConcurrentDictionary<long,TaskCompletionSource<Dictionary<string,object>>> pending=new ConcurrentDictionary<long,TaskCompletionSource<Dictionary<string,object>>>();
    readonly SemaphoreSlim writeLock=new SemaphoreSlim(1,1);
    long sequence;bool disposed;
    public static string FindSdk() {
      var candidates=new List<string>();
      var hint=Environment.GetEnvironmentVariable("CLOUDSDK_ROOT_DIR");if(!String.IsNullOrWhiteSpace(hint))candidates.Add(hint);
      candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Google","Cloud SDK","google-cloud-sdk"));
      candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),"Google","Cloud SDK","google-cloud-sdk"));
      candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"Google","Cloud SDK","google-cloud-sdk"));
      foreach(var part in (Environment.GetEnvironmentVariable("PATH")??"").Split(Path.PathSeparator)) {
        if(File.Exists(Path.Combine(part,"gcloud.cmd")))candidates.Add(Path.GetFullPath(Path.Combine(part,"..")));
      }
      foreach(var root in candidates)if(File.Exists(Path.Combine(root,"lib","gcloud.py"))&&File.Exists(Path.Combine(root,"platform","bundledpython","python.exe")))return root;
      throw new InvalidOperationException("Google Cloud CLI was not found. Use Connection setup to install or sign in.");
    }
    public static string Quote(string value) {
      if(value.IndexOfAny(new[]{'\r','\n','\0'})>=0)throw new ArgumentException("Invalid process argument.");
      var b=new StringBuilder("\"");int slashes=0;
      foreach(char c in value) { if(c=='\\'){slashes++;continue;}if(c=='"'){b.Append('\\',slashes*2+1);b.Append('"');slashes=0;continue;}b.Append('\\',slashes);slashes=0;b.Append(c); }
      b.Append('\\',slashes*2);return b.Append('"').ToString();
    }
    public async Task Open(Dictionary<string,object> config,CancellationToken token) {
      var sdk=FindSdk();var target=Json.Map(config,"production");
      string project=Json.Text(target,"project"),zone=Json.Text(target,"zone"),vm=Json.Text(target,"instance"),user=Json.Text(target,"sshUser");
      foreach(var field in new[]{project,zone,vm,user})if(!System.Text.RegularExpressions.Regex.IsMatch(field,@"^[a-zA-Z0-9._-]+$"))throw new InvalidDataException("The production connection settings are invalid.");
      var command=Json.Text(target,"command");
      // The broker command is embedded in this build, never supplied by a page or RPC reply.
      var args="-S "+Quote(Path.Combine(sdk,"lib","gcloud.py"))+" compute ssh "+Quote(user+"@"+vm)+" --project="+Quote(project)+" --zone="+Quote(zone)+" --tunnel-through-iap --quiet --ssh-flag=-T --command="+Quote(command);
      string dry;
      using(var discoveryChildren=new ChildGroup())
      using(var discovery=Process.Start(new ProcessStartInfo(Path.Combine(sdk,"platform","bundledpython","python.exe"),args+" --dry-run") {UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8})) {
        discoveryChildren.Add(discovery);
        var output=discovery.StandardOutput.ReadToEndAsync();var discoveryErrors=discovery.StandardError.ReadToEndAsync();
        var exit=Task.Run(()=>discovery.WaitForExit());
        if(await Task.WhenAny(exit,Task.Delay(45000,token))!=exit){token.ThrowIfCancellationRequested();throw new IOException("Google Cloud connection discovery timed out.");}
        dry=await output;await discoveryErrors;
        if(discovery.ExitCode!=0)throw new IOException("Google Cloud connection discovery failed. Check sign-in and production access.");
      }
      // The Windows gcloud SSH wrapper supplies its own stdin ('y'), so launch
      // its discovered PuTTY transport directly to preserve the JSON RPC stream.
      var keyMatch=Regex.Match(dry,@"(?:^|\s)-i\s+(?:""([^""]+)""|(\S+))");
      var hostMatch=Regex.Match(dry,Regex.Escape(user)+@"@compute\.[0-9]+");
      var plink=Path.Combine(sdk,"bin","sdk","plink.exe");
      if(!keyMatch.Success||!hostMatch.Success||!File.Exists(plink))throw new IOException("The Google Cloud SSH transport could not be discovered.");
      var key=keyMatch.Groups[1].Success?keyMatch.Groups[1].Value:keyMatch.Groups[2].Value;
      if(!File.Exists(key))throw new IOException("The Google Cloud SSH identity was not found.");
      // PuTTY also parses backslashes inside proxy commands before Windows does.
      var proxy=Quote(Path.Combine(sdk,"platform","bundledpython","python.exe").Replace("\\","\\\\"))+" -S "+Quote(Path.Combine(sdk,"lib","gcloud.py").Replace("\\","\\\\"))+" compute start-iap-tunnel "+Quote(vm)+" "+Quote("%port")+" --listen-on-stdin --project="+Quote(project)+" --zone="+Quote(zone)+" --verbosity=warning";
      var transport="-T -batch -i "+Quote(key)+" -proxycmd "+Quote(proxy)+" "+Quote(hostMatch.Value)+" "+Quote(command);
      children=new ChildGroup();
      process=new Process { StartInfo=new ProcessStartInfo(plink,transport) {
        UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8
      },EnableRaisingEvents=true };
      process.Exited+=(s,e)=>FailPending(new IOException("The production connection closed."));
      process.Start();children.Add(process);
      var ignored=Pump();var errors=PumpErrors();
      // Detect a failed SSH/authentication attempt promptly; hello performs the handshake.
      await Task.Delay(100,token);
      if(process.HasExited)throw new IOException("Production could not be reached. Check Google Cloud sign-in.");
    }
    async Task Pump() {
      try {
        while(!disposed) {
          var line=await process.StandardOutput.ReadLineAsync();if(line==null)break;
          if(line.Length>65536)throw new InvalidDataException("Production returned an oversized response.");
          if(!line.StartsWith("{",StringComparison.Ordinal))continue;
          Dictionary<string,object> response;try{response=Json.Read(line);}catch{continue;}
          long id;if(!Int64.TryParse(Json.Text(response,"id"),out id))continue;
          TaskCompletionSource<Dictionary<string,object>> waiter;
          if(pending.TryRemove(id,out waiter))waiter.TrySetResult(response);
        }
      }catch(Exception){Files.Log("Production response stream interrupted.");}
      finally{FailPending(new IOException("The production connection was interrupted."));}
    }
    async Task PumpErrors() {
      try {while(!disposed){var line=await process.StandardError.ReadLineAsync();if(line==null)break;
        // Do not persist command lines, access tokens or raw remote errors.
        if(line.IndexOf("reauth",StringComparison.OrdinalIgnoreCase)>=0||line.IndexOf("auth login",StringComparison.OrdinalIgnoreCase)>=0)Files.Log("Google Cloud sign-in needs attention.");
        else if(line.StartsWith("FATAL ERROR:",StringComparison.Ordinal))Files.Log("The SSH transport could not connect. Check the network and Google Cloud sign-in.");
        else if(line.IndexOf("Local worker broker",StringComparison.OrdinalIgnoreCase)>=0||line.StartsWith("ERROR:",StringComparison.Ordinal)||line.IndexOf("Permission denied",StringComparison.OrdinalIgnoreCase)>=0)Files.Log(line);
      }}catch{}
    }
    public async Task<Dictionary<string,object>> Call(string action,object data,CancellationToken token) {
      if(disposed||process==null||process.HasExited)throw new IOException("Production is disconnected.");
      var id=Interlocked.Increment(ref sequence);var completion=new TaskCompletionSource<Dictionary<string,object>>(TaskCreationOptions.RunContinuationsAsynchronously);pending[id]=completion;
      try {
        await writeLock.WaitAsync(token);
        try {await process.StandardInput.WriteLineAsync(Json.Write(new {id=id,action=action,data=data}));await process.StandardInput.FlushAsync();}finally{writeLock.Release();}
        var finished=await Task.WhenAny(completion.Task,Task.Delay(45000,token));
        token.ThrowIfCancellationRequested();
        if(finished!=completion.Task)throw new IOException("Production did not respond in time.");
        var response=await completion.Task;
        if(!Json.Flag(response,"ok")){var error=Json.Map(response,"error");throw new RpcException(Json.Text(error,"code"),Json.Text(error,"message","Production rejected this request."));}
        return Json.Map(response,"data");
      }finally{TaskCompletionSource<Dictionary<string,object>> unused;pending.TryRemove(id,out unused);}
    }
    void FailPending(Exception error) {foreach(var item in pending){TaskCompletionSource<Dictionary<string,object>> value;if(pending.TryRemove(item.Key,out value))value.TrySetException(error);} }
    public void Dispose() {if(disposed)return;disposed=true;if(children!=null)children.Dispose();FailPending(new IOException("Connection closed."));if(process!=null)process.Dispose();}
  }
}
