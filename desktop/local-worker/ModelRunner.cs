using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Grapsi.LocalWorker {
  internal sealed class ModelRunner : IDisposable {
    readonly Assets assets;readonly Action<string,string> status;
    Process process;ChildGroup children;HttpClient client;string endpoint;
    public bool Running { get {try{return process!=null&&!process.HasExited;}catch{return false;}} }
    public ModelRunner(Assets value,Action<string,string> update) {assets=value;status=update;}
    public async Task Ensure(CancellationToken token) {
      if(Running) {
        try {using(var health=await client.GetAsync(endpoint+"/health",token)){if(health.IsSuccessStatusCode)return;}}catch(OperationCanceledException){token.ThrowIfCancellationRequested();}catch{}
        Stop();
      }
      while(Memory.Available()<3500UL*1024*1024) {
        status("Waiting for memory","Close unused applications to free memory. No new analysis is running.");
        await Task.Delay(15000,token);
      }
      status("Starting model","Preparing local analysis.");
      var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();int port=((IPEndPoint)listener.LocalEndpoint).Port;listener.Stop();
      endpoint="http://127.0.0.1:"+port;
      var keyFile=Path.Combine(Files.Private,"model-api-key.txt");
      if(!File.Exists(keyFile)) {var bytes=new byte[32];using(var random=RandomNumberGenerator.Create())random.GetBytes(bytes);Files.Atomic(keyFile,Encoding.ASCII.GetBytes(BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant()));}
      var key=File.ReadAllText(keyFile).Trim();
      var args="--model "+Connection.Quote(assets.ModelPath)+" --host 127.0.0.1 --port "+port+" --alias grapsi-local-screen --ctx-size 2048 --parallel 1 --threads "+Math.Max(1,Math.Min(3,Environment.ProcessorCount-1))+" --threads-batch 3 --n-gpu-layers 0 --no-repack --batch-size 512 --ubatch-size 128 --cache-ram 0 --jinja --reasoning off --reasoning-budget 0 --api-key-file "+Connection.Quote(keyFile);
      children=new ChildGroup();
      process=new Process {StartInfo=new ProcessStartInfo(assets.RuntimePath,args) {UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=Path.GetDirectoryName(assets.RuntimePath),RedirectStandardOutput=true,RedirectStandardError=true} };
      process.Start();children.Add(process);
      try{process.PriorityClass=ProcessPriorityClass.BelowNormal;}catch(System.ComponentModel.Win32Exception){}
      // Drain without persisting page content, requests or credentials.
      var outTask=Drain(process.StandardOutput);var errorTask=Drain(process.StandardError);
      client=new HttpClient(new HttpClientHandler { UseProxy=false }) {Timeout=TimeSpan.FromSeconds(180)};
      client.DefaultRequestHeaders.Authorization=new AuthenticationHeaderValue("Bearer",key);
      var limit=DateTime.UtcNow.AddSeconds(120);
      while(DateTime.UtcNow<limit) {
        token.ThrowIfCancellationRequested();
        if(process.HasExited)throw new IOException("The local model stopped while loading. It will be restarted.");
        try {using(var health=await client.GetAsync(endpoint+"/health",token)){if(health.IsSuccessStatusCode){status("Model ready","Local analysis is available.");return;}}}
        catch(OperationCanceledException){token.ThrowIfCancellationRequested();}catch(HttpRequestException){}
        await Task.Delay(500,token);
      }
      Stop();throw new IOException("The model did not become ready. It will be restarted.");
    }
    static async Task Drain(StreamReader reader) {try{var buffer=new char[4096];while(await reader.ReadAsync(buffer,0,buffer.Length)>0){}}catch{}}
    public async Task<Dictionary<string,object>> Classify(Dictionary<string,object> job,string template,CancellationToken token) {
      await Ensure(token);
      var payload=Json.Map(job,"payload");var page=Json.Map(payload,"page");
      status("Analysing",Engine.PageTitle(page));
      var prompt=template.Replace("{DATE}",Json.Text(payload,"asOfDate"));
      var watch=Stopwatch.StartNew();
      var schema=new {type="object",properties=new {type=new {type="string",@enum=new[]{"CALL","RELATED","GENERAL","UNSURE"}}},required=new[]{"type"},additionalProperties=false};
      var body=new {model="grapsi-local-screen",messages=new[]{new{role="system",content=prompt},new{role="user",content=Json.Write(page)}},response_format=new {type="json_schema",json_schema=new {name="call_filter",strict=true,schema=schema}},temperature=0,max_tokens=24,stream=false,seed=42,reasoning_effort="none"};
      using(var content=new StringContent(Json.Write(body),Encoding.UTF8,"application/json"))
      using(var response=await client.PostAsync(endpoint+"/v1/chat/completions",content,token)) {
        // An oversized/unreadable page is retained for stronger review, not retried forever.
        if(response.StatusCode==HttpStatusCode.BadRequest)return new Dictionary<string,object>{{"decision","UNSURE"},{"elapsedMs",(int)watch.ElapsedMilliseconds}};
        response.EnsureSuccessStatusCode();
        var json=Json.Read(await response.Content.ReadAsStringAsync());
        Dictionary<string,object> choice=null;foreach(var item in Json.List(json,"choices")){choice=item as Dictionary<string,object>;break;}
        var message=Json.Map(choice,"message");var result=Json.Read(Json.Text(message,"content"));
        var decision=Json.Text(result,"type");
        if(Array.IndexOf(new[]{"CALL","RELATED","GENERAL","UNSURE"},decision)<0)throw new InvalidDataException("The local model returned an invalid classification.");
        return new Dictionary<string,object>{{"decision",decision},{"elapsedMs",(int)watch.ElapsedMilliseconds}};
      }
    }
    public void Stop() {
      if(client!=null){client.Dispose();client=null;}
      if(children!=null){children.Dispose();children=null;}
      if(process!=null){process.Dispose();process=null;}
    }
    public void Dispose() {Stop();}
  }
}
