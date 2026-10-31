using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Grapsi.LocalWorker {
  internal sealed class WorkerForm : Form {
    readonly Label state=new Label(),detail=new Label(),counts=new Label(),mode=new Label();
    readonly LinkLabel page=new LinkLabel();
    readonly Button start=new Button(),pause=new Button(),setup=new Button(),logs=new Button();
    readonly CheckBox startup=new CheckBox();
    readonly ListView recent=new ListView();
    readonly NotifyIcon tray=new NotifyIcon();
    CancellationTokenSource stop;Task running;bool closing,autoStart;
    const string RunKey=@"Software\Microsoft\Windows\CurrentVersion\Run";
    public WorkerForm(bool automatic) {
      autoStart=automatic;Text="Grapsi Local Worker";Icon=SystemIcons.Application;
      Size=new Size(800,590);MinimumSize=new Size(700,500);StartPosition=FormStartPosition.CenterScreen;
      Font=new Font("Segoe UI",10);BackColor=Color.FromArgb(246,248,251);AutoScaleMode=AutoScaleMode.Dpi;
      var layout=new TableLayoutPanel {Dock=DockStyle.Fill,Padding=new Padding(24),ColumnCount=1,RowCount=9};
      layout.RowStyles.Add(new RowStyle(SizeType.Absolute,42));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,40));
      layout.RowStyles.Add(new RowStyle(SizeType.Absolute,40));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,26));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,42));
      layout.RowStyles.Add(new RowStyle(SizeType.Absolute,48));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,32));
      layout.RowStyles.Add(new RowStyle(SizeType.Percent,100));layout.RowStyles.Add(new RowStyle(SizeType.Absolute,42));
      var title=new Label {Text="Grapsi Local Worker",Font=new Font("Segoe UI",19,FontStyle.Bold),Dock=DockStyle.Fill,ForeColor=Color.FromArgb(22,37,61)};
      state.Text="Ready";state.Font=new Font("Segoe UI",15,FontStyle.Bold);state.ForeColor=Color.FromArgb(25,107,83);state.Dock=DockStyle.Fill;
      detail.Text="Start to connect to production and analyse queued funding pages.";detail.Dock=DockStyle.Fill;detail.ForeColor=Color.FromArgb(64,77,97);
      // The page being analysed, so it can be opened in the browser.
      page.Dock=DockStyle.Fill;page.AutoEllipsis=true;page.LinkColor=Color.FromArgb(29,78,216);page.Visible=false;
      page.LinkClicked+=(s,e)=>OpenPage(page.Tag as string);
      counts.Text="Production queue: —     Results sent this session: 0";counts.Dock=DockStyle.Fill;
      var actions=new FlowLayoutPanel {Dock=DockStyle.Fill,WrapContents=false};
      start.Text="Start";start.Width=115;start.Height=36;start.BackColor=Color.FromArgb(22,100,79);start.ForeColor=Color.White;start.FlatStyle=FlatStyle.Flat;
      pause.Text="Pause";pause.Width=115;pause.Height=36;pause.Enabled=false;
      setup.Text="Connection setup";setup.Width=160;setup.Height=36;
      logs.Text="Open logs";logs.Width=120;logs.Height=36;
      actions.Controls.AddRange(new Control[]{start,pause,setup,logs});
      mode.Text="Review mode · Results are saved in production for review.";mode.ForeColor=Color.FromArgb(93,105,124);mode.Dock=DockStyle.Fill;
      recent.View=View.Details;recent.FullRowSelect=true;recent.GridLines=false;recent.Dock=DockStyle.Fill;recent.BackColor=Color.White;recent.BorderStyle=BorderStyle.FixedSingle;
      recent.Columns.Add("Recent page",300);recent.Columns.Add("Result",90);recent.Columns.Add("Time",60);recent.Columns.Add("Page address",280);
      // Double-click a result, or right-click it, to open or copy its page address.
      var rowMenu=new ContextMenuStrip();
      rowMenu.Items.Add("Open page",null,(s,e)=>{if(recent.SelectedItems.Count>0)OpenPage(recent.SelectedItems[0].Tag as string);});
      rowMenu.Items.Add("Copy page address",null,(s,e)=>{var url=recent.SelectedItems.Count>0?recent.SelectedItems[0].Tag as string:null;if(!String.IsNullOrEmpty(url))Clipboard.SetText(url);});
      recent.ContextMenuStrip=rowMenu;
      recent.DoubleClick+=(s,e)=>{if(recent.SelectedItems.Count>0)OpenPage(recent.SelectedItems[0].Tag as string);};
      startup.Text="Start when I sign in to Windows";startup.AutoSize=true;startup.Dock=DockStyle.Fill;
      using(var key=Registry.CurrentUser.OpenSubKey(RunKey))startup.Checked=key!=null&&key.GetValue("GrapsiLocalWorker")!=null;
      layout.Controls.Add(title,0,0);layout.Controls.Add(state,0,1);layout.Controls.Add(detail,0,2);layout.Controls.Add(page,0,3);layout.Controls.Add(counts,0,4);
      layout.Controls.Add(actions,0,5);layout.Controls.Add(mode,0,6);layout.Controls.Add(recent,0,7);layout.Controls.Add(startup,0,8);Controls.Add(layout);
      start.Click+=async(s,e)=>await Begin();pause.Click+=async(s,e)=>await Halt();
      logs.Click+=(s,e)=>Process.Start(new ProcessStartInfo("notepad.exe",Connection.Quote(Files.LogPath)){UseShellExecute=true});
      setup.Click+=async(s,e)=>await Setup();
      startup.CheckedChanged+=(s,e)=>{try{using(var key=Registry.CurrentUser.CreateSubKey(RunKey)){if(startup.Checked)key.SetValue("GrapsiLocalWorker",Connection.Quote(Application.ExecutablePath)+" --background");else key.DeleteValue("GrapsiLocalWorker",false);}}catch{startup.Checked=false;MessageBox.Show(this,"Windows could not save the startup preference.","Grapsi");}};
      tray.Icon=SystemIcons.Application;tray.Text="Grapsi Local Worker";tray.Visible=true;
      tray.DoubleClick+=(s,e)=>{Show();WindowState=FormWindowState.Normal;Activate();};
      var menu=new ContextMenuStrip();menu.Items.Add("Open",null,(s,e)=>{Show();WindowState=FormWindowState.Normal;Activate();});
      menu.Items.Add("Pause",null,async(s,e)=>await Halt());menu.Items.Add("Start",null,async(s,e)=>await Begin());menu.Items.Add("Exit",null,(s,e)=>Close());tray.ContextMenuStrip=menu;
      Resize+=(s,e)=>{if(WindowState==FormWindowState.Minimized)Hide();};
      Shown+=async(s,e)=>{if(autoStart){autoStart=false;await Begin();}};
      FormClosing+=async(s,e)=>{if(closing)return;e.Cancel=true;closing=true;await Halt();tray.Visible=false;Close();};
    }
    void Ui(Action action) {if(IsDisposed||Disposing)return;try{if(InvokeRequired)BeginInvoke(action);else action();}catch(InvalidOperationException){}}
    public void UpdateState(string value,string explanation) {Ui(()=>{state.Text=value;detail.Text=explanation;tray.Text=("Grapsi: "+value).Substring(0,Math.Min(63,("Grapsi: "+value).Length));});}
    void UpdateStats(Dictionary<string,object> value) {Ui(()=>{int queued=0,failed=0;foreach(var row in Json.List(value,"jobs")){var item=row as Dictionary<string,object>;if(Json.Text(item,"state")=="QUEUED")queued+=Json.Number(item,"count");if(Json.Text(item,"state")=="FAILED")failed+=Json.Number(item,"count");}counts.Text="Production queue: "+queued+"     Sent this session: "+sent+(failed>0?"     Needs attention: "+failed:"");});}
    int sent;
    void AddResult(string title,string decision,int milliseconds,string url) {Ui(()=>{sent++;var row=new ListViewItem(title){Tag=WebAddress(url)};row.SubItems.Add(decision);row.SubItems.Add((milliseconds/1000.0).ToString("0.0")+" s");row.SubItems.Add(WebAddress(url)??"");recent.Items.Insert(0,row);while(recent.Items.Count>100)recent.Items.RemoveAt(recent.Items.Count-1);});}
    void ShowPage(string url) {Ui(()=>{var address=WebAddress(url);page.Tag=address;page.Text=address??"";page.Visible=address!=null;});}
    // Only an http(s) address is shown or opened; anything else in a job is ignored.
    static string WebAddress(string url) {Uri uri;return !String.IsNullOrWhiteSpace(url)&&Uri.TryCreate(url,UriKind.Absolute,out uri)&&(uri.Scheme==Uri.UriSchemeHttp||uri.Scheme==Uri.UriSchemeHttps)?uri.AbsoluteUri:null;}
    void OpenPage(string url) {var address=WebAddress(url);if(address==null)return;try{Process.Start(new ProcessStartInfo(address){UseShellExecute=true});}catch(Exception error){MessageBox.Show(this,"The browser could not be opened: "+error.Message,"Grapsi");}}
    async Task Begin() {
      if(running!=null&&!running.IsCompleted)return;stop=new CancellationTokenSource();start.Enabled=false;pause.Enabled=true;
      var engine=new Engine(UpdateState,UpdateStats,AddResult){CurrentPage=ShowPage};
      running=Task.Run(async()=>{try{await engine.Run(0,false,stop.Token);}catch(OperationCanceledException){}catch(Exception error){Files.Log("Worker stopped: "+error.GetType().Name);UpdateState("Needs attention",error.Message);}finally{Ui(()=>{start.Enabled=true;pause.Enabled=false;});}});
      await Task.Yield();
    }
    async Task Halt() {if(stop!=null)stop.Cancel();if(running!=null){try{await running;}catch{}}start.Enabled=true;pause.Enabled=false;}
    async Task Setup() {
      try {
        string sdk=Connection.FindSdk();
        setup.Enabled=false;
        var args="-S "+Connection.Quote(Path.Combine(sdk,"lib","gcloud.py"))+" auth login --brief";
        using(var process=Process.Start(new ProcessStartInfo(Path.Combine(sdk,"platform","bundledpython","python.exe"),args){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true})) {
          var output=process.StandardOutput.ReadToEndAsync();var errors=process.StandardError.ReadToEndAsync();await Task.Run(()=>process.WaitForExit());await output;await errors;
          UpdateState(process.ExitCode==0?"Signed in":"Sign-in incomplete","Use Start to reconnect to production.");
        }
      }catch(InvalidOperationException) {Process.Start(new ProcessStartInfo("https://cloud.google.com/sdk/docs/install-sdk"){UseShellExecute=true});}
      catch(Exception error){MessageBox.Show(this,error.Message,"Connection setup");}finally{setup.Enabled=true;}
    }
    public void Preview(string filename) {
      ShowInTaskbar=false;Location=new Point(-3000,-3000);Show();Application.DoEvents();
      UpdateState("Connected · Waiting for jobs","Queued work stays in production while this laptop is unavailable.");
      counts.Text="Production queue: 12     Results sent this session: 3";start.Enabled=false;pause.Enabled=true;
      ShowPage("https://www.example.org/funding/research-grant-2027");
      AddResult("Research grant: applications invited","CALL",14900,"https://www.example.org/funding/research-grant-2027");AddResult("Programme guidelines and eligibility","RELATED",6200,"https://www.example.org/funding/guidelines");AddResult("Research award ceremony","GENERAL",4800,"https://www.example.org/news/award-ceremony");
      PerformLayout();Application.DoEvents();using(var image=new Bitmap(Width,Height)){DrawToBitmap(image,new Rectangle(0,0,Width,Height));image.Save(filename,System.Drawing.Imaging.ImageFormat.Png);}Close();
    }
    protected override void Dispose(bool disposing) {if(disposing){tray.Dispose();if(stop!=null)stop.Dispose();}base.Dispose(disposing);}
  }
  internal static class Program {
    [STAThread] static int Main(string[] args) {
      ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
      Files.Initialize();
      if(args.Contains("--child-test")){Thread.Sleep(30000);return 0;}
      if(args.Contains("--self-test"))return SelfTest.Run();
      bool created;using(var mutex=new Mutex(true,@"Local\Grapsi.LocalWorker."+WindowsUser(),out created)) {
        if(!created){if(!args.Contains("--headless"))MessageBox.Show("Grapsi Local Worker is already running. Open it from the tray.","Grapsi");return 0;}
        try {
          if(args.Contains("--headless")) {
            int maximum=3;foreach(var arg in args)if(arg.StartsWith("--max-jobs="))Int32.TryParse(arg.Substring(11),out maximum);
            var engine=new Engine((s,d)=>Files.Log(s+": "+d),value=>{},(t,d,ms,u)=>Files.Log("Result: "+d+" ("+ms+" ms)"));
            engine.Run(Math.Max(1,maximum),args.Contains("--once"),CancellationToken.None).GetAwaiter().GetResult();return 0;
          }
          Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
          var preview=args.FirstOrDefault(a=>a.StartsWith("--preview="));using(var form=new WorkerForm(preview==null)){
            if(preview!=null){form.Preview(preview.Substring(10));return 0;}
            if(args.Contains("--background"))form.WindowState=FormWindowState.Minimized;
            Application.Run(form);
          }
          return 0;
        }catch(Exception error){Files.Log("Application error: "+error.GetType().Name);if(!args.Contains("--headless"))MessageBox.Show(error.Message,"Grapsi Local Worker");return 1;}
      }
    }
    static string WindowsUser() {return System.Security.Principal.WindowsIdentity.GetCurrent().User.Value.Replace("-","");}
  }
}
