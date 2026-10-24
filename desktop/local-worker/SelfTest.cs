using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace Grapsi.LocalWorker {
  internal static class SelfTest {
    static void Check(bool condition,string message){if(!condition)throw new InvalidOperationException(message);}
    public static int Run() {
      var report=Path.Combine(Files.Root,"self-test.json");
      try {
        foreach(var argument in new[]{"","simple","two words",@"C:\A B\folder\", "embedded \"quote\"", @"trailing\\"}) {
          int count;var pointer=CommandLineToArgvW("program.exe "+Connection.Quote(argument),out count);
          try {Check(count==2,"Argument count");Check(Marshal.PtrToStringUni(Marshal.ReadIntPtr(pointer,IntPtr.Size))==argument,"Argument round trip");}finally{LocalFree(pointer);}
        }
        var json=Json.Read("{\"items\":[{\"type\":\"CALL\"}],\"ok\":true}");
        Check(Json.List(json,"items").Count()==1&&Json.Flag(json,"ok"),"JSON parsing");
        var filename=Path.Combine(Files.Private,"self-test-"+Guid.NewGuid().ToString("N")+".dat");
        try {Files.Protect(filename,new {value="अनुदान",id=Guid.NewGuid().ToString()});Check(Json.Text(Files.Unprotect(filename),"value")=="अनुदान","Encrypted outbox round trip");}
        finally {if(File.Exists(filename))File.Delete(filename);}
        using(var group=new ChildGroup())
        using(var child=Process.Start(new ProcessStartInfo(Application.ExecutablePath,"--child-test"){UseShellExecute=false,CreateNoWindow=true})) {
          group.Add(child);Thread.Sleep(150);group.Dispose();Check(child.WaitForExit(5000),"Child cleanup");
        }
        var config=Json.Read(Files.Resource("config.json"));Check(Json.Text(config,"policyHash").Length==64,"Embedded policy");
        Check(Json.Text(Json.Map(config,"model"),"sha256").Length==64,"Embedded model");
        Files.Atomic(report,Encoding.UTF8.GetBytes(Json.Write(new {passed=true,checks=new[]{"Windows argument quoting","Unicode JSON","Encrypted durable outbox","Owned child cleanup","Embedded model policy"}})));
        return 0;
      }catch(Exception error){Files.Atomic(report,Encoding.UTF8.GetBytes(Json.Write(new {passed=false,error=error.Message})));return 1;}
    }
    [DllImport("shell32.dll",SetLastError=true)] static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)]string command,out int count);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr value);
  }
}
