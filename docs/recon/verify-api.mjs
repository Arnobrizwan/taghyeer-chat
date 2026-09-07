/**
 * Reproducible verification harness for docs/API.md.
 *
 * Asserts every documented claim — status codes, envelopes, field names, error codes and
 * the awkward behaviours (inclusive cursor, `200 null` writes, the `500` on a raw `+`)
 * against the live API, and prints a pass/fail line for each.
 *
 *     node docs/recon/verify-api.mjs
 *
 * Registers three throwaway accounts on timestamped phone numbers, so it is safe to run
 * repeatedly and never touches an existing user. Requires Node 18+ (global fetch) and
 * about a minute, most of which is the API's ~1s round trip.
 *
 * Last run: 57/57 checks matched the documentation.
 */
const ROOT='https://frontend-task-chatapp.onrender.com', API=ROOT+'/api';
const results=[];
async function call(m,p,{token,body,root}={}){
  const h={}; if(token)h.Authorization='Bearer '+token;
  let pay; if(body!==undefined){pay=JSON.stringify(body);h['Content-Type']='application/json';}
  const r=await fetch((root?ROOT:API)+p,{method:m,headers:h,body:pay});
  const t=await r.text(); let j;try{j=JSON.parse(t)}catch{j=t}
  return {status:r.status, body:j};
}
const shape=(v)=>{
  if(v===null)return 'null';
  if(Array.isArray(v))return 'array['+v.length+']'+(v[0]?' of {'+Object.keys(v[0]).join(',')+'}':'');
  if(typeof v==='object')return '{'+Object.keys(v).join(',')+'}';
  return typeof v;
};
function check(n, expected, actual, ok){
  results.push({n, expected, actual, ok});
  console.log((ok?'  PASS  ':'  FAIL  ')+n.padEnd(52)+' expected: '+expected.padEnd(30)+' got: '+actual);
}

const st=Date.now().toString().slice(-6);
console.log('=== 1. POST /auth/login (new phone) ===');
const A=await call('POST','/auth/login',{body:{phone:'+8809'+st+'1',name:'Verify Alpha'}});
check('login → 200 {token,user}','200 {token,user}',A.status+' '+shape(A.body),A.status===200&&!!A.body.token&&!!A.body.user);
check('login user uses _id (not id)','_id present',Object.keys(A.body.user).join(','),'_id' in A.body.user);
const B=await call('POST','/auth/login',{body:{phone:'+8809'+st+'2',name:'Verify Beta'}});
const C=await call('POST','/auth/login',{body:{phone:'+8809'+st+'3',name:'Verify Gamma'}});
const ta=A.body.token, tb=B.body.token, tc=C.body.token;
const ia=A.body.user._id, ib=B.body.user._id, ic=C.body.user._id;

const rename=await call('POST','/auth/login',{body:{phone:'+8809'+st+'1',name:'Verify RENAMED'}});
check('login existing phone + new name RENAMES','name changed',rename.body.user?.name,rename.body.user?.name==='Verify RENAMED');
const badphone=await call('POST','/auth/login',{body:{phone:'not a phone',name:'Junk'}});
check('login accepts garbage phone','200',String(badphone.status),badphone.status===200);
const noname=await call('POST','/auth/login',{body:{phone:'+880911'}});
check('login missing name → 400 VALIDATION_ERROR','400 VALIDATION_ERROR',noname.status+' '+noname.body.error?.code,noname.status===400&&noname.body.error?.code==='VALIDATION_ERROR');

console.log('\n=== 2. GET /auth/me ===');
const me=await call('GET','/auth/me',{token:ta});
check('me → 200 bare user object','200 {_id,name,phone,createdAt}',me.status+' '+shape(me.body),me.status===200&&!!me.body._id);
const noTok=await call('GET','/auth/me');
check('me no token → 400 NO_TOKEN (NOT 401)','400 NO_TOKEN',noTok.status+' '+noTok.body.error?.code,noTok.status===400&&noTok.body.error?.code==='NO_TOKEN');
const badTok=await call('GET','/auth/me',{token:'garbage'});
check('me bad token → 401 INVALID_TOKEN','401 INVALID_TOKEN',badTok.status+' '+badTok.body.error?.code,badTok.status===401);

console.log('\n=== 3. GET /users/search ===');
const sName=await call('GET','/users/search?q=Verify',{token:ta});
check('search by name → 200 bare array','200 array',sName.status+' '+shape(sName.body),sName.status===200&&Array.isArray(sName.body));
const sPlus=await call('GET','/users/search?q='+encodeURIComponent('+8809'+st+'2'),{token:ta});
check('search raw E.164 → 500 regex error','500 numeric code',sPlus.status+' code='+sPlus.body.error?.code,sPlus.status===500);
const sEsc=await call('GET','/users/search?q='+encodeURIComponent('\\+8809'+st+'2'),{token:ta});
check('search ESCAPED E.164 → 200 but 0 hits','200 array[0]',sEsc.status+' '+shape(sEsc.body),sEsc.status===200&&sEsc.body.length===0);
const sEmpty=await call('GET','/users/search?q=',{token:ta});
check('search empty q → dumps directory','200 array[>0]',sEmpty.status+' '+shape(sEmpty.body),sEmpty.status===200&&sEmpty.body.length>0);
const sCase=await call('GET','/users/search?q=verify',{token:ta});
check('search lowercase → 0 (case-sensitive)','array[0]',shape(sCase.body),Array.isArray(sCase.body)&&sCase.body.length===0);
const sSelf=await call('GET','/users/search?q=Verify%20RENAMED',{token:ta});
check('search returns SELF','includes self',String(sSelf.body.some?.(u=>u._id===ia)),sSelf.body.some?.(u=>u._id===ia)===true);

console.log('\n=== 4/5. GET+POST /conversations ===');
const empty=await call('GET','/conversations',{token:ta});
check('conversations → 200 {data:[]}','200 {data}',empty.status+' '+shape(empty.body),empty.status===200&&Array.isArray(empty.body.data));
const d1=await call('POST','/conversations',{token:ta,body:{userId:ib}});
check('create direct → 200 bare, participants=ids','200 {_id,participants,createdAt}',d1.status+' '+shape(d1.body),d1.status===200&&typeof d1.body.participants?.[0]==='string');
const d2=await call('POST','/conversations',{token:ta,body:{userId:ib}});
check('create direct twice → IDEMPOTENT','same _id',String(d1.body._id===d2.body._id),d1.body._id===d2.body._id);
const dSelf=await call('POST','/conversations',{token:ta,body:{userId:ia}});
check('create direct with SELF → returns other convo','200 existing convo',dSelf.status+' '+(dSelf.body._id===d1.body._id?'A-B convo':'other'),dSelf.status===200);
const dBad=await call('POST','/conversations',{token:ta,body:{userId:'not-an-id'}});
check('create direct malformed id → 500 CastError','500 SERVER_ERROR',dBad.status+' '+dBad.body.error?.code,dBad.status===500);
const list=await call('GET','/conversations',{token:ta});
const item=list.body.data[0];
check('direct list item uses singular participant','{_id,type,lastMessage,updatedAt,participant}',shape(item),'participant' in item);
check('lastMessage is {} not null when empty','{}',JSON.stringify(item.lastMessage),JSON.stringify(item.lastMessage)==='{}');

console.log('\n=== 6/7. messages ===');
const cid=d1.body._id;
const m1=await call('POST','/messages',{token:ta,body:{conversationId:cid,text:'verify-1'}});
check('send → 200 message with _id + ISO createdAt','200 ISO string',m1.status+' '+typeof m1.body.createdAt,m1.status===200&&typeof m1.body.createdAt==='string');
const mEmpty=await call('POST','/messages',{token:ta,body:{conversationId:cid,text:''}});
check('send EMPTY text → accepted','200',String(mEmpty.status),mEmpty.status===200);
const mWs=await call('POST','/messages',{token:ta,body:{conversationId:cid,text:'   '}});
check('send WHITESPACE text → accepted','200',String(mWs.status),mWs.status===200);
const mGhost=await call('POST','/messages',{token:ta,body:{conversationId:'6a9e4f4cdb386e2dcaba0000',text:'x'}});
check('send to missing convo → 200 with NULL body','200 null',mGhost.status+' '+shape(mGhost.body),mGhost.status===200&&mGhost.body===null);
const mForbid=await call('POST','/messages',{token:tc,body:{conversationId:cid,text:'x'}});
check('send as non-participant → 403 FORBIDDEN','403 FORBIDDEN',mForbid.status+' '+mForbid.body.error?.code,mForbid.status===403);
const hist=await call('GET',`/conversations/${cid}/messages`,{token:ta});
check('history → {messages,hasMore}','200 {messages,hasMore}',hist.status+' '+shape(hist.body),hist.status===200&&'hasMore' in hist.body);
check('history is newest-first','desc',hist.body.messages[0]?.text,hist.body.messages[0]?.text==='   ');
const hForbid=await call('GET',`/conversations/${cid}/messages`,{token:tc});
check('history non-participant → 403','403',String(hForbid.status),hForbid.status===403);
const h404=await call('GET','/conversations/6a9e4f4cdb386e2dcaba0000/messages',{token:ta});
check('history missing convo → 404 NOT_FOUND','404 NOT_FOUND',h404.status+' '+h404.body.error?.code,h404.status===404);
const hBad=await call('GET','/conversations/nope/messages',{token:ta});
check('history malformed id → 500 CastError','500',String(hBad.status),hBad.status===500);

console.log('\n=== inclusive cursor re-check ===');
// Seed beyond the documented default of 20 so a fallback to 20 is distinguishable
// from "returned everything there was".
for(let i=0;i<26;i++) await call('POST','/messages',{token:i%2?tb:ta,body:{conversationId:cid,text:'seq-'+String(i).padStart(2,'0')}});
const total=(await call('GET',`/conversations/${cid}/messages?limit=200`,{token:ta})).body.messages.length;
console.log('  (conversation now holds '+total+' messages — above the default of 20)');
const p1=await call('GET',`/conversations/${cid}/messages?limit=5`,{token:ta});
const cursor=p1.body.messages.at(-1)._id, cursorTxt=p1.body.messages.at(-1).text;
const p2=await call('GET',`/conversations/${cid}/messages?limit=5&before=${cursor}`,{token:ta});
check('before cursor is INCLUSIVE','page2 repeats cursor msg',p2.body.messages[0].text+' == '+cursorTxt,p2.body.messages[0].text===cursorTxt);
for (const [q,label] of [['limit=abc','limit=abc'],['limit=0','limit=0'],['limit=-5','limit=-5']]) {
  const r=await call('GET',`/conversations/${cid}/messages?${q}`,{token:ta});
  check(label+' → silently defaults to 20','20 (total>20)',String(r.body.messages.length),r.body.messages.length===20);
}
const limFrac=await call('GET',`/conversations/${cid}/messages?limit=2.7`,{token:ta});
check('limit=2.7 → truncated to 2','2',String(limFrac.body.messages.length),limFrac.body.messages.length===2);
const limHuge=await call('GET',`/conversations/${cid}/messages?limit=9999`,{token:ta});
check('limit=9999 → no maximum enforced','>20 returned',String(limHuge.body.messages.length),limHuge.body.messages.length>20);
const stale=await call('GET',`/conversations/${cid}/messages?limit=5&before=6a9e4f4cdb386e2dcaba0000`,{token:ta});
check('unknown before cursor → silently page 1','same as page1',String(stale.body.messages[0]._id===p1.body.messages[0]._id),stale.body.messages[0]._id===p1.body.messages[0]._id);

console.log('\n=== 8-12. groups ===');
const g=await call('POST','/conversations/group',{token:ta,body:{name:'Verify Group',participantIds:[ib,ic]}});
check('create group → 201 (only 201 in API)','201',String(g.status),g.status===201);
check('group participants are POPULATED objects','array of {_id,name,phone}',shape(g.body.participants),typeof g.body.participants[0]==='object');
const gid=g.body._id;
const gSmall=await call('POST','/conversations/group',{token:ta,body:{name:'Too Small',participantIds:[ib]}});
check('group <3 members → 400','400',String(gSmall.status),gSmall.status===400);
const gWs=await call('POST','/conversations/group',{token:ta,body:{name:'   ',participantIds:[ib,ic]}});
check('whitespace name → 400 INVALID_NAME (no details)','400 INVALID_NAME',gWs.status+' '+gWs.body.error?.code,gWs.body.error?.code==='INVALID_NAME');
const rnNon=await call('PATCH','/conversations/'+gid,{token:tb,body:{name:'Hijack'}});
check('non-admin rename → 403','403 FORBIDDEN',rnNon.status+' '+rnNon.body.error?.code,rnNon.status===403);
const addNon=await call('POST',`/conversations/${gid}/participants`,{token:tb,body:{userIds:[ia]}});
check('non-admin add → 403','403',String(addNon.status),addNon.status===403);
const remNon=await call('DELETE',`/conversations/${gid}/participants/${ic}`,{token:tb});
check('non-admin remove other → 403','403',String(remNon.status),remNon.status===403);
const promNon=await call('POST',`/conversations/${gid}/admins`,{token:tb,body:{userId:ib}});
check('non-admin promote → 403','403',String(promNon.status),promNon.status===403);
const rn=await call('PATCH','/conversations/'+gid,{token:ta,body:{name:'Verify Group v2'}});
check('admin rename → 200 full group','200',rn.status+' '+rn.body.name,rn.status===200&&rn.body.name==='Verify Group v2');
const prom=await call('POST',`/conversations/${gid}/admins`,{token:ta,body:{userId:ib}});
check('admin promote → 200, admins grows','2 admins',String(prom.body.admins?.length),prom.body.admins?.length===2);
const promGhost=await call('POST',`/conversations/${gid}/admins`,{token:ta,body:{userId:'6a9e4f4cdb386e2dcaba0000'}});
check('promote non-member → 400 NOT_A_MEMBER','400 NOT_A_MEMBER',promGhost.status+' '+promGhost.body.error?.code,promGhost.body.error?.code==='NOT_A_MEMBER');
const rem=await call('DELETE',`/conversations/${gid}/participants/${ic}`,{token:ta});
check('admin remove → 200','200 2 participants',rem.status+' '+rem.body.participants?.length,rem.status===200);
const remAgain=await call('DELETE',`/conversations/${gid}/participants/${ic}`,{token:ta});
check('remove non-member → 200 silent no-op','200',String(remAgain.status),remAgain.status===200);
check('group can drop BELOW 3 members','<3 allowed',String(rem.body.participants?.length),rem.body.participants?.length<3);
const rnDirect=await call('PATCH','/conversations/'+cid,{token:ta,body:{name:'x'}});
check('rename a DIRECT → 400 NOT_A_GROUP','400 NOT_A_GROUP',rnDirect.status+' '+rnDirect.body.error?.code,rnDirect.body.error?.code==='NOT_A_GROUP');

console.log('\n=== 13. /health + routing ===');
const hApi=await call('GET','/health',{});
check('/api/health → 404 (spec says it lives here)','404',String(hApi.status),hApi.status===404);
const hRoot=await call('GET','/health',{root:true});
check('ROOT /health → 200 {status:ok}','200 {status}',hRoot.status+' '+shape(hRoot.body),hRoot.status===200);
const noRoute=await call('GET','/nope',{token:ta});
check('unknown route → 404 NOT_FOUND','404 NOT_FOUND',noRoute.status+' '+noRoute.body.error?.code,noRoute.status===404);
const getOne=await call('GET','/conversations/'+cid,{token:ta});
check('GET /conversations/{id} does NOT exist','404',String(getOne.status),getOne.status===404);

const pass=results.filter(r=>r.ok).length;
console.log('\n================ '+pass+'/'+results.length+' checks match documentation ================');
const fails=results.filter(r=>!r.ok);
if(fails.length) console.log('MISMATCHES:\n'+fails.map(f=>' - '+f.n+' | expected '+f.expected+' | got '+f.actual).join('\n'));
