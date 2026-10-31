using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Threading;
using System.Threading.Tasks;

namespace Grapsi.LocalWorker {
  internal sealed class Assets {
    public readonly Dictionary<string,object> Config;
    public readonly Dictionary<string,object> Model;
    public string ModelPath,RuntimePath;
    readonly Action<string,string> status;
    public Assets(Action<string,string> update) { Config=Json.Read(Files.Resource("config.json"));Model=Json.Map(Config,"model");status=update; }
    public async Task Prepare(CancellationToken token) {
      await Task.Run(()=>FindModel(token),token);
      if(ModelPath==null) {
        status("Preparing model","Downloading the model (2.5 GB). This can resume if interrupted.");
        ModelPath=Path.Combine(Files.Root,"models",Json.Text(Model,"filename"));Directory.CreateDirectory(Path.GetDirectoryName(ModelPath));
        await Download(Json.Text(Model,"url"),ModelPath,Json.Text(Model,"sha256"),"Model",token);
      }
      await Task.Run(()=>FindRuntime(token),token);
      if(RuntimePath==null)await InstallRuntime(token);
      status("Model ready","The local model and runtime have been verified.");
    }
    void FindModel(CancellationToken token) {
      var candidates=new List<string>();
      var explicitPath=Environment.GetEnvironmentVariable("GRAPSI_LOCAL_MODEL");if(!String.IsNullOrEmpty(explicitPath))candidates.Add(explicitPath);
      candidates.Add(Path.Combine(Files.Root,"models",Json.Text(Model,"filename")));
      candidates.Add(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"models",Json.Text(Model,"filename")));
      candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Grapsi","local-screening","models",Json.Text(Model,"filename")));
      foreach(var file in candidates) { token.ThrowIfCancellationRequested();if(!File.Exists(file))continue;status("Checking model","Verifying the model already on this computer.");if(Files.CheckModel(file,Model)){ModelPath=file;return;}Files.Log("A model candidate failed integrity verification; it will not be used."); }
    }
    bool VerifyRuntime(string root,CancellationToken token) {
      if(!File.Exists(Path.Combine(root,"llama-server.exe")))return false;
      var manifest=Json.Read(Files.Resource("runtime-manifest.json"));
      foreach(var item in manifest) { token.ThrowIfCancellationRequested();var file=Path.Combine(root,item.Key);if(!File.Exists(file)||!String.Equals(Files.Hash(file),Convert.ToString(item.Value),StringComparison.OrdinalIgnoreCase))return false; }
      return true;
    }
    void FindRuntime(CancellationToken token) {
      DiscoverRuntimeHint(token);if(RuntimePath!=null)return;
      var roots=new [] { Path.Combine(Files.Root,"runtime"),Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"runtime"),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Grapsi","local-screening","runtime") };
      foreach(var root in roots) { if(VerifyRuntime(root,token)){RuntimePath=Path.Combine(root,"llama-server.exe");return;} }
    }
    async Task InstallRuntime(CancellationToken token) {
      status("Preparing model","Downloading the verified model runtime.");
      var runtime=Json.Map(Config,"runtime");
      var archive=Path.Combine(Files.Root,"runtime.zip");
      await Download(Json.Text(runtime,"url"),archive,Json.Text(runtime,"sha256"),"Runtime",token);
      var target=Path.Combine(Files.Root,"runtime-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(target);
      var manifest=Json.Read(Files.Resource("runtime-manifest.json"));
      using(var zip=ZipFile.OpenRead(archive)) {
        foreach(var item in manifest) {
          token.ThrowIfCancellationRequested();
          var entry=zip.GetEntry(item.Key);
          if(entry==null||item.Key.Contains("..")||Path.IsPathRooted(item.Key))throw new InvalidDataException("The runtime archive is incomplete.");
          var file=Path.Combine(target,item.Key);Directory.CreateDirectory(Path.GetDirectoryName(file));entry.ExtractToFile(file);
        }
      }
      if(!VerifyRuntime(target,token))throw new InvalidDataException("The runtime failed its integrity check.");
      RuntimePath=Path.Combine(target,"llama-server.exe");
      // A verified location hint makes subsequent discovery independent of the EXE location.
      Files.Atomic(Path.Combine(Files.Root,"runtime-location.json"),System.Text.Encoding.UTF8.GetBytes(Json.Write(new {path=target})));
    }
    async Task Download(string url,string target,string expected,string label,CancellationToken token) {
      if(File.Exists(target)&&String.Equals(await Task.Run(()=>Files.Hash(target),token),expected,StringComparison.OrdinalIgnoreCase))return;
      var partial=target+".partial";long offset=File.Exists(partial)?new FileInfo(partial).Length:0;
      using(var client=new HttpClient { Timeout=TimeSpan.FromSeconds(60) })
      using(var request=new HttpRequestMessage(HttpMethod.Get,url)) {
        if(offset>0)request.Headers.Range=new RangeHeaderValue(offset,null);
        using(var response=await client.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,token)) {
          if(response.StatusCode==HttpStatusCode.RequestedRangeNotSatisfiable&&offset>0) {
            if(String.Equals(await Task.Run(()=>Files.Hash(partial),token),expected,StringComparison.OrdinalIgnoreCase)){if(File.Exists(target))File.Delete(target);File.Move(partial,target);return;}
            File.Move(partial,partial+".invalid-"+DateTime.UtcNow.Ticks);throw new IOException("The interrupted download needs a fresh retry.");
          }
          response.EnsureSuccessStatusCode();
          if(response.StatusCode!=HttpStatusCode.PartialContent)offset=0;
          else if(response.Content.Headers.ContentRange==null||response.Content.Headers.ContentRange.From!=offset)throw new IOException("The download server returned an unexpected range.");
          long total=offset+(response.Content.Headers.ContentLength??0),done=offset,lastNotice=0;
          using(var input=await response.Content.ReadAsStreamAsync())
          using(var output=new FileStream(partial,offset>0?FileMode.Append:FileMode.Create,FileAccess.Write,FileShare.None,65536,true)) {
            var buffer=new byte[65536];int read;
            while((read=await ReadWithTimeout(input,buffer,token))>0) {
              await output.WriteAsync(buffer,0,read,token);done+=read;
              if(Environment.TickCount-lastNotice>1000||lastNotice==0){lastNotice=Environment.TickCount;status("Preparing model",label+": "+(done/1048576)+" MB"+(total>0?" of "+(total/1048576)+" MB":""));}
            }
            output.Flush(true);
          }
        }
      }
      status("Checking download","Verifying "+label.ToLowerInvariant()+".");
      if(!String.Equals(await Task.Run(()=>Files.Hash(partial),token),expected,StringComparison.OrdinalIgnoreCase)) { File.Move(partial,partial+".invalid-"+DateTime.UtcNow.Ticks);throw new InvalidDataException(label+" did not pass verification. It will be downloaded again."); }
      if(File.Exists(target))File.Move(target,target+".invalid-"+DateTime.UtcNow.Ticks);File.Move(partial,target);
    }
    static async Task<int> ReadWithTimeout(Stream input,byte[] buffer,CancellationToken token) {
      using(var limit=CancellationTokenSource.CreateLinkedTokenSource(token)) { limit.CancelAfter(45000);try{return await input.ReadAsync(buffer,0,buffer.Length,limit.Token);}catch(OperationCanceledException){token.ThrowIfCancellationRequested();throw new IOException("Download paused because the connection stopped responding.");} }
    }
    public void DiscoverRuntimeHint(CancellationToken token) {
      var file=Path.Combine(Files.Root,"runtime-location.json");if(!File.Exists(file))return;
      try {var root=Json.Text(Json.Read(File.ReadAllText(file)),"path");if(VerifyRuntime(root,token))RuntimePath=Path.Combine(root,"llama-server.exe");}catch(OperationCanceledException){throw;}catch{Files.Log("Ignoring an invalid runtime location hint.");}
    }
  }
}
