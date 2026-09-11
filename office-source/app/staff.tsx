'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import * as api from './office-api';
const roles:Record<api.StaffRole,string>={manager:'ผู้จัดการ — จัดการสินค้า จัดซื้อ และรายงาน',reports:'ดูรายงาน — ดูข้อมูลและส่งออก Excel',stock:'ดูสต๊อก — ดูสินค้าและยอดคงเหลือ ไม่เห็นต้นทุน'};
export default function Staff(){
 const [users,setUsers]=useState<api.StaffUser[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [draft,setDraft]=useState<{userId?:string;username:string;displayName:string;role:api.StaffRole;active:boolean;password:string;confirm:string}|null>(null);
 const [busy,setBusy]=useState(false),lock=useRef(false);
 async function refresh(){setLoading(true);try{setUsers(await api.listStaff());}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void refresh();},[]);
 async function save(e:React.FormEvent){e.preventDefault();if(!draft||lock.current)return;setError('');setNotice('');
  if(draft.password!==draft.confirm){setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');return;}
  if((!draft.userId||draft.password)&&draft.password.length<12){setError('รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร');return;}
  lock.current=true;setBusy(true);
  try{if(draft.userId)await api.updateStaff({userId:draft.userId,role:draft.role,active:draft.active,...(draft.password?{password:draft.password}:{})});else await api.createStaff({username:draft.username,displayName:draft.displayName,role:draft.role,password:draft.password});setDraft(null);setNotice('บันทึกพนักงานเรียบร้อย ใช้ชื่อผู้ใช้และรหัสผ่านเข้าเว็บไซต์นี้ได้');await refresh();}catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy(false);}
 }
 return <div className="purchasing-workspace"><div className="purchase-actions"><p>เจ้าของร้านเป็นผู้สร้างบัญชีและกำหนดสิทธิ์ พนักงานไม่ต้องใช้อีเมล</p><Button onClick={()=>{setError('');setDraft({username:'',displayName:'',role:'stock',active:true,password:'',confirm:''});}}>+ สร้างพนักงาน</Button></div>
 {error&&<p className="office-error" role="alert">{error}</p>}{notice&&<p className="office-notice" role="status">{notice}</p>}
 {loading?<p>กำลังโหลดพนักงาน…</p>:<table className="purchase-table"><thead><tr><th>พนักงาน / ชื่อผู้ใช้</th><th>สิทธิ์</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>{users.map(u=><tr key={u.user_id}><td><strong>{u.display_name}</strong><small className="cell-small">{u.username}</small></td><td>{roles[u.role]}</td><td>{u.active?'ใช้งาน':'ปิดใช้งาน'}</td><td><Button variant="outline" onClick={()=>{setError('');setDraft({userId:u.user_id,username:u.username,displayName:u.display_name,role:u.role,active:u.active,password:'',confirm:''});}}>สิทธิ์ / รหัสผ่าน</Button></td></tr>)}</tbody></table>}
 {!loading&&!users.length&&<p className="inline-help">ยังไม่มีพนักงาน กด “สร้างพนักงาน” เพื่อเพิ่มบัญชีแรก</p>}
 <Dialog open={!!draft} onOpenChange={open=>{if(!open&&!busy)setDraft(null);}}><DialogContent className="office-dialog" showCloseButton={!busy}><DialogHeader><DialogTitle>{draft?.userId?'จัดการพนักงาน':'สร้างพนักงาน'}</DialogTitle><DialogDescription>พนักงานใช้ชื่อผู้ใช้และรหัสผ่านเข้าเว็บ เจ้าของร้านเปลี่ยนสิทธิ์หรือปิดบัญชีได้ภายหลัง</DialogDescription></DialogHeader>{draft&&<form onSubmit={save} className="staff-form">
 <label className="office-field"><span>ชื่อพนักงาน</span><Input required maxLength={120} disabled={busy||!!draft.userId} value={draft.displayName} onChange={e=>setDraft({...draft,displayName:e.target.value})}/></label>
 <label className="office-field"><span>ชื่อผู้ใช้ · อังกฤษ ตัวเลข . _ - จำนวน 3–32 ตัว</span><Input required pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}" maxLength={32} autoComplete="off" disabled={busy||!!draft.userId} value={draft.username} onChange={e=>setDraft({...draft,username:e.target.value})}/></label>
 <label className="office-field"><span>สิทธิ์การใช้งาน</span><select className="native-select" disabled={busy} value={draft.role} onChange={e=>setDraft({...draft,role:e.target.value as api.StaffRole})}>{Object.entries(roles).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
 {draft.userId&&<label><input type="checkbox" disabled={busy} checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/> เปิดใช้งานบัญชีนี้</label>}
 <label className="office-field"><span>{draft.userId?'รหัสผ่านใหม่ · เว้นว่างเพื่อใช้รหัสเดิม':'รหัสผ่าน · อย่างน้อย 12 ตัวอักษร'}</span><Input type="password" minLength={12} maxLength={128} required={!draft.userId} autoComplete="new-password" disabled={busy} value={draft.password} onChange={e=>setDraft({...draft,password:e.target.value})}/></label>
 <label className="office-field"><span>ยืนยันรหัสผ่าน</span><Input type="password" required={!!draft.password} autoComplete="new-password" disabled={busy} value={draft.confirm} onChange={e=>setDraft({...draft,confirm:e.target.value})}/></label>
 {error&&<p role="alert" className="office-error">{error}</p>}<Button disabled={busy} type="submit">{busy?'กำลังบันทึก…':'บันทึกพนักงาน'}</Button></form>}</DialogContent></Dialog></div>;
}
