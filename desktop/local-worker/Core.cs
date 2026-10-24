using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace Grapsi.LocalWorker {
  internal static class Json {
    public static string Write(object value) { return new JavaScriptSerializer { MaxJsonLength=1024*1024 }.Serialize(value); }
    public static Dictionary<string,object> Read(string value) { return new JavaScriptSerializer { MaxJsonLength=1024*1024 }.Deserialize<Dictionary<string,object>>(value); }
    public static string Text(IDictionary<string,object> value,string key,string fallback="") { object found; return value!=null&&value.TryGetValue(key,out found)&&found!=null?Convert.ToString(found):fallback; }
    public static Dictionary<string,object> Map(IDictionary<string,object> value,string key) { object found;return value!=null&&value.TryGetValue(key,out found)?found as Dictionary<string,object>:null; }
    public static bool Flag(IDictionary<string,object> value,string key) { object found;return value!=null&&value.TryGetValue(key,out found)&&found is bool&&(bool)found; }
    public static IEnumerable<object> List(IDictionary<string,object> value,string key) { object found;if(value==null||!value.TryGetValue(key,out found)||found is string)return new object[0];var list=found as System.Collections.IEnumerable;return list==null?new object[0]:list.Cast<object>(); }
    public static int Number(IDictionary<string,object> value,string key,int fallback=0) { int number;return Int32.TryParse(Text(value,key),out number)?number:fallback; }
  }
  internal sealed class RpcException : Exception {
    public readonly string Code;
    public RpcException(string code,string message):base(message) { Code=code; }
  }
  internal static class Files {
    public static readonly string Root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Grapsi","LocalWorker");
    public static readonly string Private=Path.Combine(Root,"private");
    public static readonly string Outbox=Path.Combine(Private,"outbox");
    public static readonly string Archive=Path.Combine(Private,"archive");
    public static readonly string LogPath=Path.Combine(Root,"worker.log");
    static readonly object LogLock=new object();
    public static void Initialize() {
      Directory.CreateDirectory(Root);Directory.CreateDirectory(Private);
      var security=new DirectorySecurity();var user=WindowsIdentity.GetCurrent().User;
      security.SetOwner(user);security.SetAccessRuleProtection(true,false);
      var flags=InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit;
      security.AddAccessRule(new FileSystemAccessRule(user,FileSystemRights.FullControl,flags,PropagationFlags.None,AccessControlType.Allow));
      security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null),FileSystemRights.FullControl,flags,PropagationFlags.None,AccessControlType.Allow));
      Directory.SetAccessControl(Private,security);
      Directory.CreateDirectory(Outbox);Directory.CreateDirectory(Archive);
    }
    public static void Log(string text) {
      text=text.Replace("\r"," ").Replace("\n"," ");if(text.Length>600)text=text.Substring(0,600);
      lock(LogLock) {
        if(File.Exists(LogPath)&&new FileInfo(LogPath).Length>2*1024*1024) { var old=LogPath+".previous";if(File.Exists(old))File.Delete(old);File.Move(LogPath,old); }
        File.AppendAllText(LogPath,DateTimeOffset.Now.ToString("u")+" "+text+Environment.NewLine,Encoding.UTF8);
      }
    }
    public static string Hash(string filename) { using(var hash=SHA256.Create())using(var stream=File.OpenRead(filename))return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-","").ToLowerInvariant(); }
    public static void Atomic(string filename,byte[] value) {
      var temp=filename+"."+Guid.NewGuid().ToString("N")+".tmp";
      using(var stream=new FileStream(temp,FileMode.CreateNew,FileAccess.Write,FileShare.None)) { stream.Write(value,0,value.Length);stream.Flush(true); }
      if(File.Exists(filename))File.Replace(temp,filename,null);else File.Move(temp,filename);
    }
    public static void Protect(string filename,object value) { Atomic(filename,ProtectedData.Protect(Encoding.UTF8.GetBytes(Json.Write(value)),null,DataProtectionScope.CurrentUser)); }
    public static Dictionary<string,object> Unprotect(string filename) { return Json.Read(Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(filename),null,DataProtectionScope.CurrentUser))); }
    public static string DeviceId() {
      var file=Path.Combine(Private,"device.dat");if(File.Exists(file))return Json.Text(Unprotect(file),"id");
      var id=Guid.NewGuid().ToString();Protect(file,new { id=id });return id;
    }
    public static string Resource(string name) {
      using(var input=typeof(Files).Assembly.GetManifestResourceStream(name)) {
        if(input==null)throw new InvalidOperationException("Application resources are missing.");
        using(var reader=new StreamReader(input,Encoding.UTF8))return reader.ReadToEnd();
      }
    }
    public static bool CheckModel(string path,Dictionary<string,object> model) { return File.Exists(path)&&new FileInfo(path).Length==Convert.ToInt64(model["bytes"])&&String.Equals(Hash(path),Json.Text(model,"sha256"),StringComparison.OrdinalIgnoreCase); }
  }
  internal sealed class ChildGroup : IDisposable {
    IntPtr handle;
    public ChildGroup() {
      handle=CreateJobObject(IntPtr.Zero,null);if(handle==IntPtr.Zero)throw new System.ComponentModel.Win32Exception();
      var info=new ExtendedLimit();info.Basic.LimitFlags=0x2000;
      int size=Marshal.SizeOf(typeof(ExtendedLimit));var ptr=Marshal.AllocHGlobal(size);
      try { Marshal.StructureToPtr(info,ptr,false);if(!SetInformationJobObject(handle,9,ptr,(uint)size))throw new System.ComponentModel.Win32Exception(); }finally{Marshal.FreeHGlobal(ptr);}
    }
    public void Add(Process process) { if(!AssignProcessToJobObject(handle,process.Handle))throw new System.ComponentModel.Win32Exception(); }
    public void Dispose() { if(handle!=IntPtr.Zero){CloseHandle(handle);handle=IntPtr.Zero;} }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long PerProcess,PerJob;public uint LimitFlags;public UIntPtr MinimumWorkingSet,MaximumWorkingSet;public uint ActiveProcessLimit;public UIntPtr Affinity;public uint PriorityClass,SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOperation,WriteOperation,OtherOperation,ReadTransfer,WriteTransfer,OtherTransfer; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit Basic;public IoCounters Io;public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob; }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int informationClass,IntPtr info,uint length);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  }
  internal static class Memory {
    [StructLayout(LayoutKind.Sequential)] struct Status { public uint length,load;public ulong totalPhysical,availablePhysical,totalPage,availablePage,totalVirtual,availableVirtual,availableExtended; }
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GlobalMemoryStatusEx(ref Status status);
    public static ulong Available() { var status=new Status { length=(uint)Marshal.SizeOf(typeof(Status)) };return GlobalMemoryStatusEx(ref status)?status.availablePhysical:0; }
  }
}
