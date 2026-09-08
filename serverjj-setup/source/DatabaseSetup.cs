using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Http;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Dedicated installer for SERVERJJ. Every mutable path and service is fixed
// to the new Chutima installation. It never discovers or operates other DBs.
class ChutimaDatabaseSetup : Form
{
    const string Root = @"C:\ChutimaServer";
    const string Data = @"E:\ChutimaData";
    const string Service = "ChutimaPostgreSQL";
    const string ServiceAccount = @"NT SERVICE\ChutimaPostgreSQL";
    const string ArchiveHash = "59F8CE701C63C2ED623C665A5E51B3EF6F2E37CCF837B68FFEED0742D0AE6ABD";
    const string ArchiveUrl = "https://get.enterprisedb.com/postgresql/postgresql-18.6-3-windows-x64-binaries.zip";
    readonly TextBox log = new TextBox { Multiline=true, ReadOnly=true, ScrollBars=ScrollBars.Vertical, Dock=DockStyle.Fill };
    readonly Button install = new Button { Text="สร้างฐานข้อมูลชุติมาบน SERVERJJ", Dock=DockStyle.Bottom, Height=54 };
    readonly ProgressBar progress = new ProgressBar { Dock=DockStyle.Bottom, Height=20 };
    bool working;
    string Stage = "ตรวจความพร้อม";
    string cluster = Path.Combine(Data,"PostgreSQL18");
    string config = Path.Combine(Data,"Config");
    string bin = Path.Combine(Root,@"PostgreSQL18\pgsql\bin");
    JavaScriptSerializer json = new JavaScriptSerializer();

    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new ChutimaDatabaseSetup());
    }
    ChutimaDatabaseSetup()
    {
        Text="ชุติมา • เตรียมฐานข้อมูล SERVERJJ"; ClientSize=new Size(800,560); MinimumSize=Size;
        Font=new Font("Tahoma",11); StartPosition=FormStartPosition.CenterScreen;
        Controls.Add(log); Controls.Add(progress); Controls.Add(install);
        Append("สร้าง PostgreSQL 18 แยกสำหรับร้านชุติมา");
        Append("โปรแกรม: "+Root+"\r\nฐานข้อมูล: "+cluster+"\r\nบริการ: "+Service+"\r\nพอร์ต: 5433 (เฉพาะใน SERVERJJ)");
        Append("สร้างรหัสเชื่อมต่อใหม่อัตโนมัติ และเก็บในโฟลเดอร์เฉพาะของชุติมา");
        Append("ขั้นตอนนี้ยังไม่นำเข้าข้อมูลขาย และไม่เปลี่ยนฐานข้อมูลหรือบริการของโปรแกรมอื่น");
        install.Click += async delegate {
            if(working)return;working=true;install.Enabled=false;
            try { await Install(); Append("เสร็จแล้ว: สร้างฐานข้อมูล chutima พร้อมตารางเรียบร้อย\r\nขั้นต่อไปคือติดตั้งตัวเชื่อมต่อและนำเข้าข้อมูล POS"); install.Text="สร้างฐานข้อมูลเรียบร้อยแล้ว"; }
            catch(Exception error) { Append("หยุดที่: "+Stage);Append("ยังไม่เสร็จ: "+error.Message);Append("ข้อมูลที่สร้างไว้คงอยู่ ไม่มีการลบหรือย้อนกลับอัตโนมัติ");install.Text="ปิดหน้าต่างและตรวจขั้นตอนที่ค้าง"; }
            finally {working=false;}
        };
        FormClosing += delegate(object sender,FormClosingEventArgs e){if(working)e.Cancel=true;};
    }
    void Append(string value) { log.AppendText(DateTime.Now.ToString("HH:mm:ss")+"  "+value+"\r\n\r\n"); }
    void Step(string value) {Stage=value;Append(value);}
    static string Secret() {var bytes=new byte[32];using(var rng=RandomNumberGenerator.Create())rng.GetBytes(bytes);return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant();}
    static string Quote(string value) {return "\""+value.Replace("\"","\\\"")+"\"";}
    static void PrivateDirectory(string directory)
    {
        Directory.CreateDirectory(directory);
        var acl=new DirectorySecurity();acl.SetAccessRuleProtection(true,false);
        foreach(var sid in new[]{"S-1-5-18","S-1-5-32-544"})acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(sid),FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
        acl.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User,FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
        Directory.SetAccessControl(directory,acl);
    }
    static void Grant(string directory,string account,FileSystemRights rights)
    {
        var acl=Directory.GetAccessControl(directory);acl.AddAccessRule(new FileSystemAccessRule(new NTAccount(account),rights,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));Directory.SetAccessControl(directory,acl);
    }
    async Task<string> Run(string exe,string args,IDictionary<string,string> environment=null,string input=null,bool allowFailure=false)
    {
        var start=new ProcessStartInfo(exe,args){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,RedirectStandardInput=true};
        if(environment!=null)foreach(var item in environment)start.EnvironmentVariables[item.Key]=item.Value;
        using(var process=new Process{StartInfo=start})
        {
            process.Start();var output=process.StandardOutput.ReadToEndAsync();var errors=process.StandardError.ReadToEndAsync();
            if(input!=null)await process.StandardInput.WriteAsync(input);process.StandardInput.Close();
            bool ended=await Task.Run(()=>process.WaitForExit(180000));
            if(!ended){try{process.Kill();}catch{}throw new Exception("ขั้นตอนนี้ใช้เวลานานเกินกำหนด กรุณาตรวจสถานะก่อนลองใหม่");}
            var result=await output;await errors;
            if(process.ExitCode!=0&&!allowFailure)throw new Exception(Path.GetFileName(exe)+" ทำงานไม่สำเร็จ ("+process.ExitCode+")");
            return result;
        }
    }
    async Task Download(string archive)
    {
        ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
        using(var client=new HttpClient()){client.Timeout=TimeSpan.FromMinutes(20);
            using(var response=await client.GetAsync(ArchiveUrl,HttpCompletionOption.ResponseHeadersRead))
            {
                response.EnsureSuccessStatusCode();long total=response.Content.Headers.ContentLength??0,read=0;
                using(var source=await response.Content.ReadAsStreamAsync())using(var target=new FileStream(archive,FileMode.CreateNew,FileAccess.Write,FileShare.None))
                {var buffer=new byte[131072];int count;while((count=await source.ReadAsync(buffer,0,buffer.Length))>0){await target.WriteAsync(buffer,0,count);read+=count;if(total>0)progress.Value=(int)Math.Min(100,read*100/total);}target.Flush(true);}
            }
        }
    }
    async Task Install()
    {
        if(!Environment.MachineName.Equals("SERVERJJ",StringComparison.OrdinalIgnoreCase))throw new Exception("ชุดนี้ใช้บน SERVERJJ เท่านั้น");
        if(!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))throw new Exception("กรุณาเปิดชุดติดตั้งด้วยสิทธิ์ผู้ดูแล Windows");
        if(!Directory.Exists(@"E:\"))throw new Exception("ไม่พบไดรฟ์ E: สำหรับข้อมูลชุติมา");
        if(IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(p=>p.Port==5433))throw new Exception("พอร์ต 5433 มีการใช้งานอยู่ ต้องตรวจสอบก่อนติดตั้ง");
        if(Directory.Exists(cluster)||Directory.Exists(Path.Combine(Root,"PostgreSQL18")))throw new Exception("พบโฟลเดอร์ฐานข้อมูลชุติมาเดิม ต้องตรวจข้อมูลก่อนติดตั้งต่อ");
        if(File.Exists(Path.Combine(config,"database.json")))throw new Exception("พบการตั้งค่าชุติมาเดิม จะไม่สร้างทับ");
        var ownService=await Run(Path.Combine(Environment.SystemDirectory,"sc.exe"),"query "+Service,null,null,true);
        if(ownService.Contains("SERVICE_NAME"))throw new Exception("พบบริการ ChutimaPostgreSQL เดิม กรุณาตรวจการติดตั้งก่อน");
        Directory.CreateDirectory(Root);PrivateDirectory(Data);PrivateDirectory(config);
        PrivateDirectory(Path.Combine(Data,"Admin"));PrivateDirectory(Path.Combine(Data,"Backups-Chutima"));
        var cache=Path.Combine(Root,"Downloads");Directory.CreateDirectory(cache);
        var archive=Path.Combine(cache,"postgresql-18.6-3.zip");
        Step("ดาวน์โหลด PostgreSQL 18.6 สำหรับฐานข้อมูลชุติมา");
        if(!File.Exists(archive))await Download(archive);
        using(var sha=SHA256.Create())using(var file=File.OpenRead(archive))if(BitConverter.ToString(sha.ComputeHash(file)).Replace("-","")!=ArchiveHash)throw new Exception("ไฟล์ติดตั้งไม่ตรงกับต้นฉบับ หยุดเพื่อป้องกันการติดตั้งผิดไฟล์");
        Step("แยกไฟล์โปรแกรมไว้ใน C:\\ChutimaServer\\PostgreSQL18");
        await Task.Run(()=>ZipFile.ExtractToDirectory(archive,Path.Combine(Root,"PostgreSQL18")));
        var admin=Secret();var owner=Secret();var adminFile=Path.Combine(Data,@"Admin\cluster-admin.json");
        File.WriteAllText(adminFile,json.Serialize(new{host="127.0.0.1",port=5433,user="chutima_admin",password=admin}),new UTF8Encoding(false));
        var passwordFile=Path.Combine(Data,@"Admin\initialization.secret");File.WriteAllText(passwordFile,admin,new UTF8Encoding(false));
        Step("สร้างพื้นที่ฐานข้อมูล PostgreSQL ใหม่ของชุติมา");
        PrivateDirectory(cluster);
        await Run(Path.Combine(bin,"initdb.exe"),"-D "+Quote(cluster)+" -U chutima_admin --encoding=UTF8 --locale=C --auth=scram-sha-256 --pwfile="+Quote(passwordFile));
        // Delete only the temporary secret file created by this invocation.
        File.Delete(passwordFile);
        File.AppendAllText(Path.Combine(cluster,"postgresql.conf"),"\r\n# Chutima SERVERJJ dedicated instance\r\nport=5433\r\nlisten_addresses='127.0.0.1'\r\nmax_connections=20\r\nshared_buffers='256MB'\r\npassword_encryption='scram-sha-256'\r\nfsync=on\r\nsynchronous_commit=on\r\nfull_page_writes=on\r\ntimezone='Asia/Bangkok'\r\nlogging_collector=on\r\nlog_directory='log'\r\nlog_filename='chutima-%a.log'\r\nlog_rotation_age='1d'\r\nlog_truncate_on_rotation=on\r\n");
        Step("สร้างบริการ Windows ชื่อ ChutimaPostgreSQL ด้วยบัญชีบริการเฉพาะ");
        await Run(Path.Combine(bin,"pg_ctl.exe"),"register -N "+Service+" -U "+Quote(ServiceAccount)+" -D "+Quote(cluster)+" -S auto");
        PrivateDirectory(cluster);Grant(cluster,ServiceAccount,FileSystemRights.Modify);
        Grant(Data,ServiceAccount,FileSystemRights.ReadAndExecute);
        Grant(Root,ServiceAccount,FileSystemRights.ReadAndExecute);
        await Run(Path.Combine(Environment.SystemDirectory,"sc.exe"),"start "+Service);
        var environment=new Dictionary<string,string>{{"PGHOST","127.0.0.1"},{"PGPORT","5433"},{"PGUSER","chutima_admin"},{"PGPASSWORD",admin},{"PGCONNECT_TIMEOUT","5"},{"PGDATABASE","postgres"}};
        string ready="";for(int i=0;i<30;i++){ready=await Run(Path.Combine(bin,"pg_isready.exe"),"-h 127.0.0.1 -p 5433 -t 2",null,null,true);if(ready.Contains("accepting connections"))break;await Task.Delay(1000);}
        if(!ready.Contains("accepting connections"))throw new Exception("สร้างบริการแล้ว แต่ฐานข้อมูลยังไม่พร้อมรับการเชื่อมต่อ");
        Step("สร้างบัญชีและฐานข้อมูล chutima");
        var sql="CREATE ROLE chutima_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '"+owner+"';\nCREATE DATABASE chutima OWNER chutima_owner ENCODING 'UTF8' TEMPLATE template0;\nREVOKE CONNECT ON DATABASE chutima FROM PUBLIC;\nGRANT CONNECT ON DATABASE chutima TO chutima_owner;\n";
        await Run(Path.Combine(bin,"psql.exe"),"--no-password --set=ON_ERROR_STOP=1",environment,sql);
        File.WriteAllText(Path.Combine(config,"database.json"),json.Serialize(new{host="127.0.0.1",port=5433,database="chutima",user="chutima_owner",password=owner}),new UTF8Encoding(false));
        environment["PGUSER"]="chutima_owner";environment["PGPASSWORD"]=owner;environment["PGDATABASE"]="chutima";
        Step("สร้างตารางสินค้า สต๊อก ลูกค้า คิวซัก บิลขาย กะ และประวัติการซิงค์");
        string schema;using(var stream=typeof(ChutimaDatabaseSetup).Assembly.GetManifestResourceStream("chutima-schema.sql"))using(var reader=new StreamReader(stream))schema=reader.ReadToEnd();
        await Run(Path.Combine(bin,"psql.exe"),"--no-password --set=ON_ERROR_STOP=1",environment,schema);
        File.WriteAllText(Path.Combine(config,"installed.json"),json.Serialize(new{installedAt=DateTime.UtcNow.ToString("o"),machine=Environment.MachineName,service=Service,port=5433,database="chutima",postgres="18.6",dataDirectory=cluster,businessDataImported=false}),new UTF8Encoding(false));
        progress.Value=100;
    }
}
