using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Grapsi.LocalWorker {
  internal sealed class Engine {
    readonly Action<string,string> status;
    readonly Action<Dictionary<string,object>> stats;
    readonly Action<string,string,int,string> history;
    public int Completed {get;private set;}
    // The address of the page being analysed; null when none is.
    public Action<string> CurrentPage {get;set;}
    public Engine(Action<string,string> update,Action<Dictionary<string,object>> counts,Action<string,string,int,string> row) {status=update;stats=counts;history=row;}
    void Current(string url) {if(CurrentPage!=null)CurrentPage(url);}
    public async Task Run(int maximum,bool once,CancellationToken token) {
      var assets=new Assets(status);var workerId=Files.DeviceId();int failures=0;
      Connection connection=null;ModelRunner model=null;Dictionary<string,object> active=null;
      try {
        while(!token.IsCancellationRequested) {
          try {
            if(assets.ModelPath==null||assets.RuntimePath==null)await assets.Prepare(token);
            if(model==null)model=new ModelRunner(assets,status);
            connection=new Connection();status("Connecting","Connecting securely to production.");
            await connection.Open(assets.Config,token);
            var hello=await connection.Call("hello",new {protocol=Json.Number(assets.Config,"protocol"),workerId=workerId,displayName=Environment.MachineName,appVersion=Json.Text(assets.Config,"version"),modelSha256=Json.Text(assets.Model,"sha256")},token);
            if(Json.Number(hello,"protocol")!=Json.Number(assets.Config,"protocol")||Json.Text(hello,"mode")!="SHADOW"||Json.Text(hello,"policyHash")!=Json.Text(assets.Config,"policyHash"))throw new RpcException("UPGRADE_REQUIRED","Production requires an updated worker.");
            failures=0;Files.Log("Connected to production. Results are queued for review.");
            await FlushOutbox(connection,token);
            DateTime idleSince=DateTime.UtcNow,lastStats=DateTime.MinValue;
            while(!token.IsCancellationRequested) {
              if(maximum>0&&Completed>=maximum)return;
              if(DateTime.UtcNow-lastStats>TimeSpan.FromSeconds(45)) {stats(await connection.Call("status",new {},token));lastStats=DateTime.UtcNow;}
              if(!model.Running&&Memory.Available()<3500UL*1024*1024){status("Waiting for memory","Close unused applications to free memory. Jobs remain queued in production.");await Task.Delay(15000,token);continue;}
              var claimed=await connection.Call("claim",new {},token);active=Json.Map(claimed,"job");
              if(active==null) {
                if(once)return;
                Current(null);
                if(DateTime.UtcNow-idleSince>TimeSpan.FromMinutes(5)&&model.Running) {model.Stop();Files.Log("Unloaded the idle model to release memory.");}
                if(Json.Flag(claimed,"busy"))status("Recovering job","Waiting for the interrupted job lease to clear. Work remains queued.");
                else status(Json.Flag(claimed,"paused")?"Paused by production":"Waiting for jobs","Connected. Production keeps work queued while this laptop is unavailable.");
                await Task.Delay(15000,token);continue;
              }
              idleSince=DateTime.UtcNow;
              var payload=Json.Map(active,"payload");var page=Json.Map(payload,"page");
              if(Json.Text(payload,"policyHash")!=Json.Text(hello,"policyHash"))throw new RpcException("INVALID_RESULT","The job policy does not match this worker.");
              status("Analysing",PageTitle(page));Current(Json.Text(page,"url"));
              Dictionary<string,object> result;
              using(var inference=CancellationTokenSource.CreateLinkedTokenSource(token)) {
                var task=model.Classify(active,Json.Text(hello,"promptTemplate"),inference.Token);
                try {
                  while(!task.IsCompleted) {
                    await Task.WhenAny(task,Task.Delay(25000,token));token.ThrowIfCancellationRequested();
                    if(task.IsCompleted)break;
                    var beat=await connection.Call("heartbeat",new {jobId=Json.Text(active,"id"),leaseToken=Json.Text(active,"leaseToken")},token);
                    if(!Json.Flag(beat,"held"))throw new RpcException("LEASE_LOST","The page or lease changed. Production will retry it.");
                  }
                  result=await task;
                }catch {
                  inference.Cancel();try{task.GetAwaiter().GetResult();}catch{}throw;
                }
              }
              var submission=new Dictionary<string,object> {
                {"jobId",Json.Text(active,"id")},{"leaseToken",Json.Text(active,"leaseToken")},{"inputHash",Json.Text(active,"inputHash")},
                {"modelSha256",Json.Text(assets.Model,"sha256")},{"policyHash",Json.Text(hello,"policyHash")},
                {"decision",Json.Text(result,"decision")},{"details",Json.Map(result,"details")},{"elapsedMs",Json.Number(result,"elapsedMs")}
              };
              var outbox=Path.Combine(Files.Outbox,Json.Text(active,"id")+".dat");
              Files.Protect(outbox,new {submission=submission,title=PageTitle(page),url=Json.Text(page,"url")});
              status("Sending result","Saving the result in production.");
              await SendOutbox(connection,outbox,token);
              active=null;stats(await connection.Call("status",new {},token));lastStats=DateTime.UtcNow;
            }
          }catch(OperationCanceledException) {
            if(token.IsCancellationRequested)break;
            Files.Log("An operation timed out; reconnecting.");
          }catch(RpcException error) {
            Files.Log(error.Code+": "+error.Message);
            if(error.Code=="UPGRADE_REQUIRED"||error.Code=="MODEL_MISMATCH") {status("Update required",error.Message);throw;}
          }catch(Exception error) {
            Files.Log("Worker interrupted: "+error.GetType().Name+": "+error.Message+". Pending work remains queued.");
          }finally {
            if(connection!=null&&active!=null) {
              using(var release=new CancellationTokenSource(3000)) {
                try{connection.Call("release",new {jobId=Json.Text(active,"id"),leaseToken=Json.Text(active,"leaseToken"),reason=token.IsCancellationRequested?"Worker paused":"Connection or local analysis interrupted"},release.Token).GetAwaiter().GetResult();}catch{}
              }
            }
            active=null;if(connection!=null){connection.Dispose();connection=null;}
          }
          if(token.IsCancellationRequested)break;
          if(model!=null)model.Stop();
          failures++;int seconds=Math.Min(60,(int)Math.Pow(2,Math.Min(6,failures)))+new Random().Next(0,3);
          status("Reconnecting","Retrying in "+seconds+" seconds. Queued work is safe.");
          await Task.Delay(seconds*1000,token);
        }
      }finally {
        if(connection!=null)connection.Dispose();if(model!=null)model.Dispose();
        Files.Atomic(Path.Combine(Files.Root,"last-run.json"),System.Text.Encoding.UTF8.GetBytes(Json.Write(new {at=DateTime.UtcNow.ToString("o"),processed=Completed,pendingUploads=Directory.GetFiles(Files.Outbox,"*.dat").Length})));
        status("Stopped","The local model is stopped. Production retains unfinished jobs.");
      }
    }
    async Task FlushOutbox(Connection connection,CancellationToken token) {
      foreach(var file in Directory.GetFiles(Files.Outbox,"*.dat").OrderBy(n=>n)) {
        token.ThrowIfCancellationRequested();status("Sending saved result","Recovering an interrupted upload.");
        await SendOutbox(connection,file,token);
      }
    }
    internal static string PageTitle(Dictionary<string,object> page) {
      var title=Json.Text(page,"title");return String.IsNullOrWhiteSpace(title)?Json.Text(page,"url","Funding page"):title;
    }
    async Task SendOutbox(Connection connection,string filename,CancellationToken token) {
      Dictionary<string,object> saved;
      try{saved=Files.Unprotect(filename);}catch(System.Security.Cryptography.CryptographicException){Archive(filename,"unreadable");Files.Log("An unreadable saved result was retained for inspection.");return;}catch(ArgumentException){Archive(filename,"unreadable");Files.Log("An invalid saved result was retained for inspection.");return;}
      var submission=Json.Map(saved,"submission");
      try {
        var ack=await connection.Call("complete",submission,token);
        Archive(filename,Json.Flag(ack,"accepted")?"accepted":"stale");
        if(Json.Flag(ack,"accepted")) {var title=Json.Text(saved,"title");foreach(var candidate in Json.List(Json.Map(ack,"details"),"candidates")){title=Json.Text(candidate as Dictionary<string,object>,"title",title);break;}Completed++;history(title,Json.Text(submission,"decision"),Json.Number(submission,"elapsedMs"),Json.Text(saved,"url"));Files.Log("Production acknowledged an analysis result.");}
        else Files.Log("Production rejected an outdated page result; it was retained locally.");
      }catch(RpcException error) {
        if(new[]{"LEASE_LOST","NOT_FOUND","INVALID_RESULT","INVALID_REQUEST","RESULT_CONFLICT"}.Contains(error.Code)) {Archive(filename,"stale");Files.Log("A stale saved result was retained locally; current work stays with production.");return;}throw;
      }
    }
    static void Archive(string file,string state) {
      var target=Path.Combine(Files.Archive,Path.GetFileNameWithoutExtension(file)+"."+state+"."+DateTime.UtcNow.Ticks+".dat");File.Move(file,target);
    }
  }
}
