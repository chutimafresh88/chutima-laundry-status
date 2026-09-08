using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Drawing;
using System.Diagnostics;
using System.ServiceProcess;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;
class CloudUpdate:Form {
 const string Home=@"C:\ChutimaServer\Service-0.16.0", Root=@"C:\ChutimaServer", Data=@"E:\ChutimaData";
 const string Node=@"C:\ChutimaServer\Node24\node-v24.19.0-win-x64\node.exe";
 readonly TextBox log=new TextBox{Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill};
 readonly Button button=new Button{Text="อัปเดตตัวเชื่อมเว็บ SERVERJJ",Dock=DockStyle.Bottom,Height=55};
 bool working;
 [STAThread]static void Main(){Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new CloudUpdate());}
 CloudUpdate(){Text="ชุติมา • เชื่อมเว็บ SERVERJJ 0.16.1";ClientSize=new Size(820,550);Font=new Font("Tahoma",11);StartPosition=FormStartPosition.CenterScreen;Controls.Add(log);Controls.Add(button);
  Say("อัปเดตเฉพาะบริการ ChutimaServer ที่ติดตั้งไว้แล้ว\r\nสำรองฐานข้อมูลชุติมาก่อนอัปเดต และเก็บไฟล์บริการรุ่นเดิมไว้\r\nPOS ยังบันทึกงานในเครื่องได้ระหว่างอัปเดต\r\nหลังอัปเดต ให้ใช้ POS 0.16.1 เพื่อเชื่อมบัญชีเว็บเดิมอัตโนมัติ");
  button.Click+=async delegate{if(working)return;working=true;button.Enabled=false;try{await Install();Say("เสร็จแล้ว: ตัวเชื่อมเว็บพร้อมทำงาน\r\nขั้นต่อไปเปิด POS 0.16.1 บนเครื่องขาย เพื่อเชื่อมบัญชีเว็บที่เคยเข้าสู่ระบบไว้");button.Text="อัปเดตเรียบร้อยแล้ว";}catch(Exception e){Say("ยังไม่เสร็จ: "+e.Message);button.Text="ปิดหน้าต่างและส่งภาพข้อความนี้";}finally{working=false;}};
  FormClosing+=delegate(object s,FormClosingEventArgs e){if(working)e.Cancel=true;};
 }
 void Say(string s){log.AppendText(DateTime.Now.ToString("HH:mm:ss")+"  "+s+"\r\n\r\n");}
 static byte[] Resource(string name){using(var s=typeof(CloudUpdate).Assembly.GetManifestResourceStream(name))using(var o=new MemoryStream()){if(name=="server.gz"){using(var z=new GZipStream(s,CompressionMode.Decompress))z.CopyTo(o);}else s.CopyTo(o);return o.ToArray();}}
 static string Q(string s){return "\""+s.Replace("\"","\\\"")+"\"";}
 async Task Run(string exe,string args){var info=new ProcessStartInfo(exe,args){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};using(var p=Process.Start(info)){var output=p.StandardOutput.ReadToEndAsync();var error=p.StandardError.ReadToEndAsync();if(!await Task.Run(()=>p.WaitForExit(300000)))throw new Exception("ขั้นตอนยังไม่จบ กรุณาตรวจสถานะก่อนทำซ้ำ");await output;await error;if(p.ExitCode!=0)throw new Exception("ขั้นตอนสำรองหรือตรวจบริการไม่สำเร็จ กรุณาตรวจ Logs-Chutima");}}
 async Task Install(){
  if(!Environment.MachineName.Equals("SERVERJJ",StringComparison.OrdinalIgnoreCase))throw new Exception("เปิดไฟล์นี้บน SERVERJJ เท่านั้น");
  var wrapper=Path.Combine(Home,"ChutimaServer.exe");
  using(var reg=Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\ChutimaServer")){
   var image=reg==null?null:reg.GetValue("ImagePath") as string;
   if(image==null||!image.Trim().Trim('"').Equals(wrapper,StringComparison.OrdinalIgnoreCase))throw new Exception("บริการที่พบไม่ตรงกับ ChutimaServer เดิม");
  }
  foreach(var f in new[]{Node,wrapper,Path.Combine(Home,"server.cjs"),Path.Combine(Home,"schema.sql"),Path.Combine(Data,@"Config\server.json"),Path.Combine(Data,@"TLS\ca.pem")})if(!File.Exists(f))throw new Exception("ไฟล์ชุติมาเดิมไม่ครบ กรุณาตรวจการติดตั้ง");
  var update=Path.Combine(Root,"Updates",DateTime.Now.ToString("yyyyMMdd-HHmmss")+"-"+Guid.NewGuid().ToString("N").Substring(0,8));Directory.CreateDirectory(update);
  File.WriteAllBytes(Path.Combine(update,"backup.cjs"),Resource("backup.cjs"));File.WriteAllBytes(Path.Combine(update,"readiness.cjs"),Resource("readiness.cjs"));
  var files=new[]{"server.cjs","schema.sql"};var contents=new[]{Resource("server.gz"),Resource("schema.sql")};
  foreach(var f in files)File.Copy(Path.Combine(Home,f),Path.Combine(update,f+".previous"));
  using(var service=new ServiceController("ChutimaServer")){
   service.Refresh();var wasRunning=service.Status==ServiceControllerStatus.Running;bool replaced=false;Exception failure=null;
   try{
    Say("พักบริการชุติมาเพื่ออัปเดต");if(service.Status!=ServiceControllerStatus.Stopped){service.Stop();await Task.Run(()=>service.WaitForStatus(ServiceControllerStatus.Stopped,TimeSpan.FromSeconds(90)));}
    Say("สำรองฐานข้อมูลชุติมาและตรวจไฟล์สำรองก่อนอัปเดต");await Run(Node,Q(Path.Combine(update,"backup.cjs"))+" "+Q(Path.Combine(Data,@"Config\server.json")));
    Say("ติดตั้งตัวเชื่อมเว็บและระบบตรวจนับร่วมกับ POS");replaced=true;
    for(int i=0;i<files.Length;i++){var target=Path.Combine(Home,files[i]);var temp=Path.Combine(Home,files[i]+".update");File.WriteAllBytes(temp,contents[i]);File.Replace(temp,target,null);}
    service.Start();await Task.Run(()=>service.WaitForStatus(ServiceControllerStatus.Running,TimeSpan.FromSeconds(60)));
    Say("ตรวจบริการ HTTPS ด้วยใบรับรองเดิมของร้าน");await Run(Node,Q(Path.Combine(update,"readiness.cjs"))+" 127.0.0.1 "+Q(Path.Combine(Data,@"TLS\ca.pem"))+" 0.16.1");
    File.WriteAllText(Path.Combine(update,"complete.txt"),DateTime.UtcNow.ToString("o"));
   }catch(Exception error){failure=error;}
   if(failure!=null){
    Say("อัปเดตไม่สำเร็จ กำลังคืนไฟล์บริการรุ่นก่อน");service.Refresh();
    if(service.Status!=ServiceControllerStatus.Stopped){service.Stop();await Task.Run(()=>service.WaitForStatus(ServiceControllerStatus.Stopped,TimeSpan.FromSeconds(90)));}
    if(replaced)foreach(var f in files)File.Copy(Path.Combine(update,f+".previous"),Path.Combine(Home,f),true);
    if(wasRunning){service.Start();await Task.Run(()=>service.WaitForStatus(ServiceControllerStatus.Running,TimeSpan.FromSeconds(60)));}
    throw failure;
   }
  }
 }
}
