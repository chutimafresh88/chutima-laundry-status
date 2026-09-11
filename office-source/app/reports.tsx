'use client';
import {useRef,useState,useEffect} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {printDocument} from './print-document';
import * as api from './office-api';
import type {OfficeData,ReportPage} from './office-api';
const types={overview:'ภาพรวมเงินรับจริง',laundry:'งานซัก–อบ',sales:'ขายสินค้าและกำไรขั้นต้น',cash:'รับเงิน–คืนเงิน',stock:'สต๊อกและต้นทุนเฉลี่ย',movements:'ความเคลื่อนไหวสต๊อก',purchases:'จัดซื้อและเจ้าหนี้',shifts:'กะและเงินสด',customers:'ลูกค้าใช้บริการ',audit:'ประวัติการทำรายการ'};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(new Date());
export default function Reports({data}:{data:OfficeData}){
 const [kind,setKind]=useState<keyof typeof types>('overview'),[from,setFrom]=useState(today),[to,setTo]=useState(today),[result,setResult]=useState<ReportPage|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState('');const lock=useRef(false),abort=useRef(false);
 useEffect(()=>()=>{abort.current=true;},[]);
 async function load(){if(lock.current)return;lock.current=true;abort.current=false;setBusy(true);setError('');setResult(null);try{
  if(!data.snapshot?.reportVersion)throw Error('รออัปเดตระบบรายงานบน SERVERJJ');if(!from||!to||from>to)throw Error('เลือกช่วงวันที่ให้ถูกต้อง');
  let offset=0,hash='',all:ReportPage['rows']=[],last:ReportPage|null=null;
  while(!abort.current){const id=crypto.randomUUID();await api.submit(id,'purchase.receive',{workflow:'report.prepare',kind,from,to,offset,expectedHash:hash||undefined});let page:ReportPage|null=null;
   for(let wait=0;wait<45&&!abort.current;wait++){setProgress(`กำลังรวบรวมรายงาน ${all.length.toLocaleString()} รายการ`);const current=await api.loadOffice(),request=current.requests.find(r=>r.id===id);if(request?.status==='rejected')throw Error(request.message);const found=current.snapshot?.reportPages?.find(p=>p.requestId===id)|| (current.snapshot?.reportPage?.requestId===id?current.snapshot.reportPage:null);if(found){page=found;break;}await new Promise(resolve=>setTimeout(resolve,2000));}
   if(abort.current)throw Error('หยุดโหลดรายงานแล้ว');if(!page)throw Error('SERVERJJ ยังไม่ส่งรายงาน กรุณาตรวจการเชื่อมต่อแล้วลองใหม่');
   if(hash&&hash!==page.hash)throw Error('ข้อมูลเปลี่ยนระหว่างโหลด กรุณาเริ่มใหม่');hash=page.hash;all.push(...page.rows);last=page;
   if(!page.hasMore)break;if(!page.rows.length)throw Error('หน้ารายงานไม่ต่อเนื่อง');offset+=page.rows.length;
  }
  if(last&&!abort.current)setResult({...last,offset:0,rows:all,hasMore:false});
 }catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);setProgress('');}}
 async function exportFile(){if(!result)return;const {downloadExcel}=await import('./excel-export');downloadExcel(result.rows,{'รายงาน':types[result.kind as keyof typeof types],'ตั้งแต่':result.from,'ถึง':result.to,'สร้างรายงาน':result.generatedAt,'ซิงค์ล่าสุดที่หน้าเว็บ':data.snapshotAt,'จำนวนรายการ':result.rows.length,'หมายเหตุ':result.note},'ชุติมา-'+result.kind+'-'+result.from+'-'+result.to);}
 const columns=result?.rows[0]?Object.keys(result.rows[0]):[];
 return <section className="purchasing-workspace"><div className="purchasing-actions"><div><h2>รายงานร้านชุติมา</h2><p>เลือกช่วงวันที่ แล้วสร้างรายงานจาก SERVERJJ</p></div><Button variant="outline" disabled={!result||busy} onClick={()=>void exportFile()}>ส่งออก Excel</Button><Button variant="outline" disabled={!result||busy} onClick={()=>result&&printDocument(types[result.kind as keyof typeof types],[result.from+' – '+result.to,result.note],result.rows)}>พิมพ์ / PDF</Button></div>
 <div className="report-filters"><label className="office-field"><span>รายงาน</span><select disabled={busy} value={kind} onChange={e=>setKind(e.target.value as keyof typeof types)}>{Object.entries(types).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label><label className="office-field"><span>ตั้งแต่</span><Input disabled={busy} type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="office-field"><span>ถึง</span><Input disabled={busy} type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><Button disabled={busy||!data.snapshot?.reportVersion} onClick={()=>void load()}>สร้างรายงาน</Button></div>
 <div className="purchasing-tabs"><Button variant="outline" disabled={busy} onClick={()=>{setFrom(today());setTo(today());}}>วันนี้</Button><Button variant="outline" disabled={busy} onClick={()=>{const d=today();setFrom(d.slice(0,8)+'01');setTo(d);}}>เดือนนี้</Button>{busy&&<Button variant="outline" onClick={()=>{abort.current=true;}}>หยุดโหลด</Button>}</div>
 {!data.snapshot?.reportVersion&&<p className="purchasing-note">ต้องอัปเดต SERVERJJ ก่อนเปิดรายงานส่วนกลาง</p>}
 {data.devices?.some(d=>!d.online||d.pending>0)&&<p className="purchasing-note">มีเครื่องออฟไลน์หรือรายการรอส่ง รายงานอาจยังไม่ครบ</p>}{busy&&<p role="status">{progress}</p>}{error&&<p className="office-error" role="alert">{error}</p>}
 {result&&<><p className="purchasing-note">{types[result.kind as keyof typeof types]} · {result.from} – {result.to} · {result.rows.length.toLocaleString()} รายการ<br/>{result.note}</p><div className="purchasing-table-wrap"><table className="purchasing-table"><thead><tr>{columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{result.rows.slice(0,200).map((r,i)=><tr key={i}>{columns.map(c=><td key={c}>{typeof r[c]==='number'?r[c].toLocaleString('th-TH',{maximumFractionDigits:2}):r[c]??'—'}</td>)}</tr>)}</tbody></table></div>{result.rows.length>200&&<p>แสดงตัวอย่าง 200 รายการ · Excel มีครบ {result.rows.length.toLocaleString()} รายการ</p>}{!result.rows.length&&<p className="purchasing-empty">ไม่พบข้อมูลในช่วงวันที่เลือก</p>}</>}
 </section>;
}
