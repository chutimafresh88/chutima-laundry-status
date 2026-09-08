using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// This installer operates only the dedicated Chutima paths and service.
// It does not migrate business data, alter PostgreSQL/SML, or enter passwords.
class ChutimaServiceSetup : Form
{
    const string Root=@"C:\ChutimaServer", Data=@"E:\ChutimaData", Service="ChutimaServer";
    const string Account=@"NT SERVICE\ChutimaServer";
    const string NodeUrl="https://nodejs.org/download/release/v24.19.0/node-v24.19.0-win-x64.zip";
    const string NodeHash="57F71AB3652E797D84ACDDC79C81CC9FF1C6DDB2A1974CDB83F00FEE9BFF4C73";
    const string WrapperUrl="https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe";
    const string WrapperHash="05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA";
    readonly string home=Path.Combine(Root,"Service-0.16.0"), config=Path.Combine(Data,"Config"), tls=Path.Combine(Data,"TLS"), pairing=Path.Combine(Data,"Pairing");
    readonly TextBox log=new TextBox{Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical,Dock=DockStyle.Fill};
    readonly TextBox address=new TextBox{Dock=DockStyle.Top,Height=32};
    readonly Button install=new Button{Text="ติดตั้งตัวเชื่อมต่อ POS บน SERVERJJ",Dock=DockStyle.Bottom,Height=54};
    readonly ProgressBar progress=new ProgressBar{Dock=DockStyle.Bottom,Height=20};
    readonly JavaScriptSerializer json=new JavaScriptSerializer();
    bool working;string stage="ตรวจข้อมูลการติดตั้ง";
    readonly List<string> secrets=new List<string>();
    [STAThread]static void Main(){Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new ChutimaServiceSetup());}
    ChutimaServiceSetup(){
        Text="ชุติมา • ติดตั้งตัวเชื่อมต่อ SERVERJJ 0.16.0";ClientSize=new Size(820,610);Font=new Font("Tahoma",11);StartPosition=FormStartPosition.CenterScreen;
        var label=new Label{Text="IP ภายในร้านของ SERVERJJ",Dock=DockStyle.Top,Height=30};
        Controls.Add(log);Controls.Add(address);Controls.Add(label);Controls.Add(progress);Controls.Add(install);
        var ips=LocalIps();address.Text=ips.Contains("192.168.1.135")?"192.168.1.135":ips.FirstOrDefault()??"";
        Append("ติดตั้งบริการ ChutimaServer พอร์ต HTTPS 8443 สำหรับ POS ภายในร้าน\r\nใช้ฐานข้อมูล chutima ที่สร้างแล้ว บน 127.0.0.1:5433\r\nสร้างไฟล์จับคู่ POS และสำรองข้อมูลทุกชั่วโมงใน E:\\ChutimaData\\Backups-Chutima\r\nขั้นตอนนี้ยังไม่นำเข้าหรือเปลี่ยนข้อมูลขาย และยังไม่เชื่อมเว็บหลังบ้าน");
        install.Click+=async delegate{if(working)return;working=true;install.Enabled=false;address.Enabled=false;
            try{await Install(address.Text.Trim());Append("เสร็จแล้ว: ตัวเชื่อมต่อ SERVERJJ พร้อมทำงาน\r\nไฟล์จับคู่: E:\\ChutimaData\\Pairing\\SERVERJJ-pos-connection.json\r\nยังไม่ได้นำเข้าข้อมูล POS ขั้นต่อไปคือติดตั้ง POS รุ่นที่รองรับและตรวจข้อมูลก่อนจับคู่");install.Text="ติดตั้งตัวเชื่อมต่อเรียบร้อยแล้ว";}
            catch(Exception error){var message=error.Message;foreach(var secret in secrets)message=message.Replace(secret,"[hidden]");Append("ยังไม่เสร็จ • "+stage+"\r\n"+message);install.Text="ปิดหน้าต่างและส่งภาพขั้นตอนที่ค้าง";}
            finally{working=false;}};
        FormClosing+=delegate(object sender,FormClosingEventArgs e){if(working)e.Cancel=true;};
    }
    static string[] LocalIps(){return NetworkInterface.GetAllNetworkInterfaces().Where(n=>n.OperationalStatus==OperationalStatus.Up).SelectMany(n=>n.GetIPProperties().UnicastAddresses).Where(a=>a.Address.AddressFamily==AddressFamily.InterNetwork&&!IPAddress.IsLoopback(a.Address)).Select(a=>a.Address.ToString()).ToArray();}
    void Append(string value){log.AppendText(DateTime.Now.ToString("HH:mm:ss")+"  "+value+"\r\n\r\n");}
    void Step(string value){stage=value;Append(value);}
    static string Quote(string value){return "\""+value.Replace("\"","\\\"")+"\"";}
    static string Hash(byte[] bytes){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","");}
    static string HashFile(string file){using(var sha=SHA256.Create())using(var stream=File.OpenRead(file))return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","");}
    static string Secret(){var bytes=new byte[32];using(var rng=RandomNumberGenerator.Create())rng.GetBytes(bytes);return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant();}
    static void PrivateDirectory(string path){Directory.CreateDirectory(path);var acl=new DirectorySecurity();acl.SetAccessRuleProtection(true,false);foreach(var sid in new[]{new SecurityIdentifier("S-1-5-18"),new SecurityIdentifier("S-1-5-32-544"),WindowsIdentity.GetCurrent().User})acl.AddAccessRule(new FileSystemAccessRule(sid,FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));Directory.SetAccessControl(path,acl);}
    static void Grant(string path,FileSystemRights rights,bool children){var acl=Directory.GetAccessControl(path);acl.AddAccessRule(new FileSystemAccessRule(new NTAccount(Account),rights,children?InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit:InheritanceFlags.None,PropagationFlags.None,AccessControlType.Allow));Directory.SetAccessControl(path,acl);}
    static void GrantFile(string path){var acl=File.GetAccessControl(path);acl.AddAccessRule(new FileSystemAccessRule(new NTAccount(Account),FileSystemRights.Read,AccessControlType.Allow));File.SetAccessControl(path,acl);}
    static void WriteNewOrSame(string file,byte[] content){if(File.Exists(file)){if(HashFile(file)!=Hash(content))throw new Exception("พบไฟล์ชุติมาคนละรุ่น จะไม่เขียนทับ: "+Path.GetFileName(file));return;}using(var stream=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.None)){stream.Write(content,0,content.Length);stream.Flush(true);}}
    static byte[] Resource(string name){using(var stream=typeof(ChutimaServiceSetup).Assembly.GetManifestResourceStream(name))using(var target=new MemoryStream()){if(name=="chutima-server.cjs"){using(var zip=new GZipStream(stream,CompressionMode.Decompress))zip.CopyTo(target);}else stream.CopyTo(target);return target.ToArray();}}
    async Task<string> Run(string exe,string args,bool allowFailure=false){var start=new ProcessStartInfo(exe,args){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};using(var process=Process.Start(start)){var stdout=process.StandardOutput.ReadToEndAsync();var stderr=process.StandardError.ReadToEndAsync();var ended=await Task.Run(()=>process.WaitForExit(180000));if(!ended)throw new Exception("ขั้นตอนใช้เวลานานเกินกำหนด ต้องตรวจสถานะก่อนทำต่อ");var result=await stdout;var error=await stderr;if(process.ExitCode!=0&&!allowFailure){var message=result+"\r\n"+error;foreach(var secret in secrets)message=message.Replace(secret,"[hidden]");if(message.Length>4500)message=message.Substring(message.Length-4500);throw new Exception(Path.GetFileName(exe)+" ทำงานไม่สำเร็จ ("+process.ExitCode+")\r\n"+message);}return result;}}
    async Task Download(string file,string url,string hash){
        if(File.Exists(file)){if(HashFile(file)!=hash)throw new Exception("ไฟล์ดาวน์โหลดเดิมไม่ครบ: "+Path.GetFileName(file));return;}
        ServicePointManager.SecurityProtocol=SecurityProtocolType.Tls12;
        using(var client=new HttpClient()){client.Timeout=TimeSpan.FromMinutes(20);using(var response=await client.GetAsync(url,HttpCompletionOption.ResponseHeadersRead)){response.EnsureSuccessStatusCode();var total=response.Content.Headers.ContentLength??0;long read=0;using(var source=await response.Content.ReadAsStreamAsync())using(var target=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.None)){var buffer=new byte[131072];int count;while((count=await source.ReadAsync(buffer,0,buffer.Length))>0){await target.WriteAsync(buffer,0,count);read+=count;if(total>0)progress.Value=(int)Math.Min(100,read*100/total);}target.Flush(true);}}}
        if(HashFile(file)!=hash)throw new Exception("ไฟล์ดาวน์โหลดไม่ตรงกับต้นฉบับ: "+Path.GetFileName(file));
    }
    static byte[] Der(byte tag,params byte[][] values){var body=values.SelectMany(v=>v).ToArray();var result=new List<byte>{tag};if(body.Length<128)result.Add((byte)body.Length);else{var size=BitConverter.GetBytes(body.Length).Reverse().SkipWhile(b=>b==0).ToArray();result.Add((byte)(128+size.Length));result.AddRange(size);}result.AddRange(body);return result.ToArray();}
    static byte[] Integer(byte[] value){var v=value.SkipWhile(b=>b==0).ToArray();if(v.Length==0)v=new byte[]{0};if(v[0]>=128)v=new byte[]{0}.Concat(v).ToArray();return Der(2,v);}
    static string Pem(string kind,byte[] value){return "-----BEGIN "+kind+"-----\n"+Convert.ToBase64String(value,Base64FormattingOptions.InsertLineBreaks)+"\n-----END "+kind+"-----\n";}
    static string PrivatePem(RSA key){var p=key.ExportParameters(true);return Pem("RSA PRIVATE KEY",Der(48,Integer(new byte[]{0}),Integer(p.Modulus),Integer(p.Exponent),Integer(p.D),Integer(p.P),Integer(p.Q),Integer(p.DP),Integer(p.DQ),Integer(p.InverseQ)));}
    void Certificates(string ip){
        var marker=Path.Combine(tls,"address.txt");if(File.Exists(marker)){if(File.ReadAllText(marker)!=ip)throw new Exception("IP เปลี่ยนจากใบรับรองเดิม ต้องออกใบรับรองใหม่ก่อน");foreach(var name in new[]{"ca.pem","server.pem","server-key.pem"})if(!File.Exists(Path.Combine(tls,name)))throw new Exception("ไฟล์ใบรับรองชุติมาไม่ครบ");return;}
        if(Directory.EnumerateFileSystemEntries(tls).Any())throw new Exception("พบใบรับรองที่สร้างไม่ครบ ต้องตรวจก่อนทำต่อ");
        using(var caKey=new RSACng(3072))using(var key=new RSACng(3072)){
            var caRequest=new CertificateRequest("CN=Chutima Store Local CA",caKey,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);
            caRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(true,false,0,true));caRequest.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign|X509KeyUsageFlags.CrlSign,true));caRequest.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(caRequest.PublicKey,false));
            using(var ca=caRequest.CreateSelfSigned(DateTimeOffset.UtcNow.AddMinutes(-10),DateTimeOffset.UtcNow.AddYears(10))){
                var request=new CertificateRequest("CN=SERVERJJ Chutima",key,HashAlgorithmName.SHA256,RSASignaturePadding.Pkcs1);
                request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false,false,0,true));request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature|X509KeyUsageFlags.KeyEncipherment,true));request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection{new Oid("1.3.6.1.5.5.7.3.1")},true));
                request.CertificateExtensions.Add(new X509Extension("2.5.29.17",Der(48,Der(130,Encoding.ASCII.GetBytes("SERVERJJ")),Der(130,Encoding.ASCII.GetBytes("localhost")),Der(135,IPAddress.Loopback.GetAddressBytes()),Der(135,IPAddress.Parse(ip).GetAddressBytes())),false));
                var serial=new byte[16];using(var rng=RandomNumberGenerator.Create())rng.GetBytes(serial);serial[0]&=0x7f;serial[0]|=1;
                using(var signed=request.Create(ca,DateTimeOffset.UtcNow.AddMinutes(-5),DateTimeOffset.UtcNow.AddYears(2),serial)){
                    File.WriteAllText(Path.Combine(tls,"ca.pem"),Pem("CERTIFICATE",ca.Export(X509ContentType.Cert)),new UTF8Encoding(false));
                    File.WriteAllText(Path.Combine(tls,"server.pem"),Pem("CERTIFICATE",signed.Export(X509ContentType.Cert)),new UTF8Encoding(false));
                    File.WriteAllText(Path.Combine(tls,"server-key.pem"),PrivatePem(key),new UTF8Encoding(false));
                    File.WriteAllText(Path.Combine(Data,@"Admin\server-ca-key.pem"),PrivatePem(caKey),new UTF8Encoding(false));
                    File.WriteAllText(marker,ip,new UTF8Encoding(false));
                }
            }
        }
    }
    async Task Install(string ip){
        if(!Environment.MachineName.Equals("SERVERJJ",StringComparison.OrdinalIgnoreCase))throw new Exception("ใช้ชุดนี้บน SERVERJJ เท่านั้น");
        if(!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))throw new Exception("ต้องเปิดด้วยสิทธิ์ผู้ดูแล Windows");
        IPAddress parsed;if(!IPAddress.TryParse(ip,out parsed)||!LocalIps().Contains(ip))throw new Exception("IP ไม่ตรงกับเครือข่ายของ SERVERJJ");
        var bytes=parsed.GetAddressBytes();if(!(bytes[0]==10||bytes[0]==192&&bytes[1]==168||bytes[0]==172&&bytes[1]>=16&&bytes[1]<=31))throw new Exception("ต้องใช้ IP ภายในร้านเท่านั้น");
        var dbFile=Path.Combine(config,"database.json");if(!File.Exists(dbFile)||!File.Exists(Path.Combine(config,"installed.json")))throw new Exception("ต้องติดตั้งฐานข้อมูลชุติมาให้เสร็จก่อน");
        var db=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(dbFile));
        if(Convert.ToString(db["host"])!="127.0.0.1"||Convert.ToInt32(db["port"])!=5433||Convert.ToString(db["database"])!="chutima"||Convert.ToString(db["user"])!="chutima_owner")throw new Exception("ข้อมูลการเชื่อมต่อไม่ใช่ฐานข้อมูลชุติมาชุดนี้");
        secrets.Add(Convert.ToString(db["password"]));
        var sc=Path.Combine(Environment.SystemDirectory,"sc.exe");var existing=await Run(sc,"query "+Service,true);bool serviceExists=existing.Contains("SERVICE_NAME");
        if(serviceExists&&!File.Exists(Path.Combine(config,"server.json")))throw new Exception("ชื่อบริการ ChutimaServer ถูกใช้แล้ว ต้องตรวจก่อนติดตั้ง");
        if(!serviceExists&&IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(p=>p.Port==8443))throw new Exception("พอร์ต 8443 มีการใช้งานอยู่ ต้องตรวจก่อนติดตั้ง");
        Directory.CreateDirectory(home);PrivateDirectory(tls);PrivateDirectory(pairing);PrivateDirectory(Path.Combine(Data,"Logs-Chutima"));
        var cache=Path.Combine(Root,"Downloads");Directory.CreateDirectory(cache);
        Step("ดาวน์โหลด Node.js จากต้นฉบับ และแยกไว้เฉพาะชุติมา");
        var nodeZip=Path.Combine(cache,"node-v24.19.0-win-x64.zip");await Download(nodeZip,NodeUrl,NodeHash);
        var runtime=Path.Combine(Root,"Node24");var node=Path.Combine(runtime,@"node-v24.19.0-win-x64\node.exe");
        if(!Directory.Exists(runtime))await Task.Run(()=>ZipFile.ExtractToDirectory(nodeZip,runtime));
        if(!File.Exists(node))throw new Exception("ไฟล์ Node.js ชุติมาไม่ครบ");
        Step("ติดตั้งไฟล์บริการเชื่อมต่อและตัวจัดการบริการ Windows");
        var wrapper=Path.Combine(home,"ChutimaServer.exe");await Download(wrapper,WrapperUrl,WrapperHash);
        WriteNewOrSame(Path.Combine(home,"server.cjs"),Resource("chutima-server.cjs"));WriteNewOrSame(Path.Combine(home,"schema.sql"),Resource("chutima-schema.sql"));WriteNewOrSame(Path.Combine(home,"readiness.cjs"),Resource("chutima-readiness.cjs"));
        WriteNewOrSame(Path.Combine(home,"THIRD-PARTY-NOTICES.txt"),Resource("chutima-notices.txt"));
        Step("สร้างใบรับรอง HTTPS เฉพาะร้าน และไฟล์จับคู่ POS");Certificates(ip);
        var serverFile=Path.Combine(config,"server.json");string pairingKey;
        if(File.Exists(serverFile)){
            var saved=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(serverFile));pairingKey=Convert.ToString(saved["pairingKey"]);
            if(Convert.ToInt32(saved["port"])!=8443||Convert.ToString(saved["host"])!="0.0.0.0"||pairingKey.Length!=64||pairingKey.Any(c=>!Uri.IsHexDigit(c)))throw new Exception("การตั้งค่าตัวเชื่อมต่อเดิมไม่ตรงกับชุดนี้");
        }else{
            pairingKey=Secret();File.WriteAllText(serverFile,json.Serialize(new{host="0.0.0.0",port=8443,database=db,pairingKey=pairingKey,tls=new{key=Path.Combine(tls,"server-key.pem"),cert=Path.Combine(tls,"server.pem")},backupDirectory=Path.Combine(Data,"Backups-Chutima"),postgresBin=Path.Combine(Root,@"PostgreSQL18\pgsql\bin")}),new UTF8Encoding(false));
        }
        secrets.Add(pairingKey);
        var connection=new{url="https://"+ip+":8443",ca=File.ReadAllText(Path.Combine(tls,"ca.pem")),pairingKey=pairingKey,label="POS ชุติมา"};
        WriteNewOrSame(Path.Combine(pairing,"SERVERJJ-pos-connection.json"),Encoding.UTF8.GetBytes(json.Serialize(connection)));
        var xml="<service><id>ChutimaServer</id><name>Chutima POS Server</name><description>Dedicated Chutima POS data service</description><executable>"+node+"</executable><arguments>&quot;"+Path.Combine(home,"server.cjs")+"&quot;</arguments><env name=\"CHUTIMA_SERVER_CONFIG\" value=\""+serverFile+"\"/><workingdirectory>"+home+"</workingdirectory><startmode>Automatic</startmode><delayedAutoStart/><depend>ChutimaPostgreSQL</depend><serviceaccount><domain>NT AUTHORITY</domain><user>LocalService</user></serviceaccount><logpath>"+Path.Combine(Data,"Logs-Chutima")+"</logpath><log mode=\"roll-by-size\"><sizeThreshold>2048</sizeThreshold><keepFiles>8</keepFiles></log><stoptimeout>90sec</stoptimeout><onfailure action=\"restart\" delay=\"15sec\"/></service>";
        WriteNewOrSame(Path.Combine(home,"ChutimaServer.xml"),Encoding.UTF8.GetBytes(xml));
        Step("สร้างบริการ ChutimaServer และสิทธิ์เข้าถึงเฉพาะข้อมูลชุติมา");
        if(!serviceExists)await Run(wrapper,"install");
        await Run(sc,"sidtype ChutimaServer unrestricted");
        Grant(Root,FileSystemRights.ReadAndExecute,true);Grant(Data,FileSystemRights.ReadAndExecute,false);Grant(config,FileSystemRights.ReadAndExecute,false);GrantFile(serverFile);Grant(tls,FileSystemRights.ReadAndExecute,true);Grant(Path.Combine(Data,"Logs-Chutima"),FileSystemRights.Modify,true);Grant(Path.Combine(Data,"Backups-Chutima"),FileSystemRights.Modify,true);
        Step("เปิดรับ HTTPS 8443 เฉพาะวง LAN ของร้าน");
        // Change only the rule owned by this installer; do not disable firewall
        // or modify any existing rule for other applications.
        var policyType=Type.GetTypeFromProgID("HNetCfg.FwPolicy2");dynamic policy=Activator.CreateInstance(policyType);bool found=false;
        foreach(dynamic rule in policy.Rules){if((string)rule.Name=="ChutimaServer HTTPS LAN 8443"){found=true;if((string)rule.ApplicationName!=node||(string)rule.LocalPorts!="8443"||(string)rule.RemoteAddresses!="LocalSubnet"||(int)rule.Protocol!=6||(int)rule.Direction!=1||(int)rule.Action!=1||!(bool)rule.Enabled)throw new Exception("กฎเครือข่ายชุติมาเดิมไม่ตรงกับชุดนี้ ต้องตรวจก่อนเปลี่ยน");}}
        if(!found){dynamic rule=Activator.CreateInstance(Type.GetTypeFromProgID("HNetCfg.FWRule"));rule.Name="ChutimaServer HTTPS LAN 8443";rule.Description="Dedicated Chutima POS HTTPS service, local subnet only";rule.ApplicationName=node;rule.Protocol=6;rule.LocalPorts="8443";rule.RemoteAddresses="LocalSubnet";rule.Direction=1;rule.Action=1;rule.Enabled=true;rule.Profiles=7;policy.Rules.Add(rule);}
        Step("เริ่มตัวเชื่อมต่อ และตรวจว่าบริการเปิดพร้อมใบรับรองของร้าน");
        var state=await Run(sc,"query ChutimaServer",true);if(!state.Contains("RUNNING"))await Run(wrapper,"start");
        await Run(node,Quote(Path.Combine(home,"readiness.cjs"))+" "+Quote(ip)+" "+Quote(Path.Combine(tls,"ca.pem")));
        File.WriteAllText(Path.Combine(config,"service-installed.json"),json.Serialize(new{installedAt=DateTime.UtcNow.ToString("o"),machine=Environment.MachineName,port=8443,url="https://"+ip+":8443",service=Service,certificateExpires=DateTime.UtcNow.AddYears(2).ToString("o"),businessDataImported=false,webConnected=false}),new UTF8Encoding(false));
        progress.Value=100;
    }
}
