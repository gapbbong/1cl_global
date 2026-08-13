(function(){
  const cfg=window.GLOBALHUB_SUPABASE||{};
  const client=window.supabase&&cfg.anonKey?window.supabase.createClient(cfg.url,cfg.anonKey):null;
  window.globalHubDb={
    async saveSchool(payload){
      localStorage.setItem('globalhub.school',JSON.stringify(payload));
      if(!client)return {local:true};
      const {error}=await client.from('schools').upsert(payload,{onConflict:'domain_name'});
      if(error)throw error;return {local:false};
    },
    async loadSchool(domain){
      if(!client)return JSON.parse(localStorage.getItem('globalhub.school')||'null');
      const {data,error}=await client.from('schools').select('*').eq('domain_name',domain).maybeSingle();
      if(error)throw error;return data;
    }
  };
  const oldSave=window.saveSchool;
  window.saveSchool=async function(){
    const type=document.getElementById('schoolType');
    const no=document.getElementById('schoolNo');
    if(!type||!no){return oldSave&&oldSave();}
    const inputs=[...document.querySelectorAll('.field input')];
    const domainInput=inputs.find(x=>x.pattern);
    const domain=domainInput?.value.trim()||'';
    if(!/^[A-Za-z]{3,}$/.test(domain)){
      domainInput?.focus();
      alert('도메인명은 영문 3자리 이상으로 입력해 주세요.');
      return;
    }
    no.value=type.value+String(Math.floor(Math.random()*10000)).padStart(4,'0');
    const payload={name:inputs[0]?.value||'미입력 학교',department:inputs[1]?.value||'',education_type:Number(type.value),class_display:'alpha',class_count:Number(document.getElementById('classCount')?.value||1),school_number:no.value,domain_name:domain,countries:[...document.querySelectorAll('#countries input')].map(x=>x.value.trim()).filter(Boolean)};
    try{await globalHubDb.saveSchool(payload);alert('학교 설정이 저장되었습니다.')}catch(e){console.error(e);alert('저장 중 오류가 발생했습니다. Supabase RLS 정책을 확인해 주세요.')}
  };
})();

// Live tenant authentication and data loading for *.creat1324.com.
(function(){
  const match=location.hostname.toLowerCase().match(/^([a-z]{3,})\.creat1324\.com$/);
  if(!match)return;
  const domain=match[1];
  const pageEl=document.getElementById('page');
  if(!pageEl)return;
  const style=document.createElement('style');
  style.textContent='.tenant-auth-wrap{min-height:80vh;display:grid;place-items:center}.tenant-auth{width:min(420px,100%);background:#fff;border:1px solid #e5e9f0;border-radius:16px;padding:32px;box-shadow:0 12px 36px #17203318}.tenant-auth h1{text-align:center;color:#365cf5;margin:0 0 12px}.tenant-auth p{text-align:center;color:#718096}.tenant-auth input{width:100%;box-sizing:border-box;padding:13px;border:1px solid #dfe4ec;border-radius:8px;margin:18px 0 10px}.tenant-auth button{width:100%;padding:13px;border:0;border-radius:8px;background:#365cf5;color:#fff;font-weight:bold;cursor:pointer}.tenant-error{text-align:center;color:#d13b4f!important;margin-top:12px}.tenant-live{max-width:1180px;margin:auto}.tenant-live-head{text-align:center;margin:12px 0 28px}.tenant-live-head h1{margin:0 0 8px}.tenant-live-classes{display:grid;grid-template-columns:repeat(3,minmax(150px,190px));justify-content:center;gap:20px}.tenant-live-class{aspect-ratio:1;border:1px solid #dfe4ec;border-radius:16px;background:#fff;font-size:24px;color:#365cf5;cursor:pointer}.tenant-live-students{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.tenant-live-student{background:#fff;border:1px solid #dfe4ec;border-radius:14px;padding:16px;text-align:center}.tenant-live-student img,.tenant-live-avatar{width:150px;aspect-ratio:1;object-fit:cover;border-radius:12px;margin:auto auto 10px;display:flex;align-items:center;justify-content:center;background:#dfe7ff;color:#365cf5;font-size:44px;font-weight:bold}.tenant-live-back{margin-bottom:16px}@media(max-width:700px){.tenant-live-classes{grid-template-columns:repeat(2,140px)}.tenant-live-students{gap:10px}.tenant-live-student{padding:10px}.tenant-live-student img,.tenant-live-avatar{width:100%}}';
  document.head.appendChild(style);
  const client=window.supabase&&window.GLOBALHUB_SUPABASE?.anonKey?window.supabase.createClient(window.GLOBALHUB_SUPABASE.url,window.GLOBALHUB_SUPABASE.anonKey):null;
  let school=null,teachers=[],students=[],selected='';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function auth(){pageEl.innerHTML='<div class="tenant-auth-wrap"><form class="tenant-auth" id="tenantAuth"><h1>선생님 인증</h1><p>학교에 등록된 교사 이메일을 입력해주세요.</p><input id="tenantEmail" type="email" placeholder="teacher@school.com" required><button>인증하기</button><p id="tenantError" class="tenant-error"></p></form></div>';document.getElementById('tenantAuth').onsubmit=verify}
  async function verify(e){e.preventDefault();const email=document.getElementById('tenantEmail').value.trim().toLowerCase(),error=document.getElementById('tenantError');error.textContent='확인 중입니다...';if(!client){error.textContent='Supabase 연결 설정을 확인해주세요.';return}try{let r=await client.from('schools').select('id,name,department').eq('domain_name',domain).maybeSingle();if(r.error)throw r.error;if(!r.data){error.textContent='등록되지 않은 학교 도메인입니다.';return}school=r.data;r=await client.from('teachers').select('id,name,email').eq('school_id',school.id).ilike('email',email).maybeSingle();if(r.error)throw r.error;if(!r.data){error.textContent='등록되지 않은 교사 이메일입니다.';return}r=await client.from('students').select('id,name,student_number,country,photo_url,answers').eq('school_id',school.id);if(r.error)throw r.error;students=r.data||[];showClasses()}catch(err){console.error(err);error.textContent='인증 정보를 확인하지 못했습니다. 관리자에게 문의해주세요.'}}
  function showClasses(){const groups=[...new Set(students.map(s=>s.answers?.class||s.answers?.class_name||'미지정'))];pageEl.innerHTML='<div class="tenant-live"><div class="tenant-live-head"><h1>'+esc(school.name)+'</h1><p>'+esc(school.department||'')+'</p></div><div class="tenant-live-classes">'+groups.map(k=>'<button class="tenant-live-class" onclick="window.openTenantClass('+JSON.stringify(k)+')">'+esc(k)+'<div style="font-size:14px;color:#718096;margin-top:8px">'+students.filter(s=>(s.answers?.class||s.answers?.class_name||'미지정')===k).length+'명</div></button>').join('')+'</div></div>'}
  window.openTenantClass=function(k){selected=k;const list=students.filter(s=>(s.answers?.class||s.answers?.class_name||'미지정')===k);pageEl.innerHTML='<div class="tenant-live"><button class="ghost tenant-live-back" onclick="window.openTenantHome()">← 반 목록</button><div class="tenant-live-head"><h1>'+esc(school.name)+'</h1><p>'+esc(school.department||'')+' · '+esc(k)+'</p></div><div class="tenant-live-students">'+list.map(s=>{const photo=s.photo_url?'<img src="'+esc(s.photo_url)+'" alt="'+esc(s.name)+' 사진">':'<div class="tenant-live-avatar">'+esc(s.name?.charAt(0)||'학')+'</div>';return '<article class="tenant-live-student">'+photo+'<b>'+esc(s.name)+'</b></article>'}).join('')+'</div></div>'};
  window.openTenantHome=showClasses;
  document.querySelector('.side')?.remove();
  auth();
})();

setTimeout(function(){
  const nav=document.querySelector('.nav');
  if(!nav||document.getElementById('publicSchoolLink'))return;
  const saved=JSON.parse(localStorage.getItem('globalhub.school')||'null')||{};
  const code=/^[a-z]{3,}$/i.test(saved.domain_name||'')?saved.domain_name.toLowerCase():'abc';
  const url='https://'+code+'.creat1324.com';
  const row=document.createElement('div');row.id='publicSchoolLink';row.style='display:flex;align-items:center;gap:4px;margin:4px 0 8px 8px';
  row.innerHTML='<a href="'+url+'" target="_blank" rel="noopener" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#365cf5;font-size:12px;text-decoration:none">'+code+'.creat1324.com</a><button type="button" aria-label="주소 복사" title="주소 복사" style="border:0;background:transparent;color:#365cf5;cursor:pointer;font-size:16px;padding:3px 6px">⧉</button>';
  row.querySelector('button').onclick=()=>navigator.clipboard.writeText(url).then(()=>alert('주소를 복사했습니다.')).catch(()=>alert(url));
  const student=nav.querySelector('[data-page="students"]');
  if(student)student.insertAdjacentElement('afterend',row);else nav.appendChild(row);
},0);

setTimeout(function(){
  const nav=document.querySelector('.nav'),student=nav?.querySelector('[data-page="students"]'),link=document.getElementById('publicSchoolLink');
  if(!nav||!student||!link||link.parentElement?.classList.contains('student-domain-row'))return;
  const row=document.createElement('div');row.className='student-domain-row';row.style='display:flex;align-items:center;gap:3px';
  student.parentElement.insertBefore(row,student);row.appendChild(student);row.appendChild(link);
  student.style.flex='1';link.style.margin='0';link.style.flex='0 0 118px';
},50);

// Place the public subdomain beside the Student Management page title.
(function(){
  const pageEl=document.getElementById('page');
  if(!pageEl)return;
  function sync(){
    const current=document.querySelector('.student-domain-toolbar');
    if(typeof page==='undefined'||page!=='students'){current?.remove();return}
    if(current)return;
    const old=document.getElementById('publicSchoolLink');
    if(old&&old.parentElement?.classList.contains('student-domain-row'))old.remove();
    const top=pageEl.querySelector('.top');
    if(!top)return;
    const saved=JSON.parse(localStorage.getItem('globalhub.school')||'null')||{};
    const code=/^[a-z]{3,}$/i.test(saved.domain_name||'')?saved.domain_name.toLowerCase():'abc';
    const url='https://'+code+'.creat1324.com';
    const toolbar=document.createElement('div');toolbar.className='student-domain-toolbar';toolbar.style='display:flex;align-items:center;gap:8px;margin-left:auto';
    toolbar.innerHTML='<a href="'+url+'" target="_blank" rel="noopener" style="color:#365cf5;text-decoration:none;font-size:13px">'+code+'.creat1324.com</a><button type="button" aria-label="주소 복사" title="주소 복사" style="border:0;background:transparent;color:#365cf5;cursor:pointer;font-size:18px;padding:2px 5px">⧉</button>';
    toolbar.querySelector('button').onclick=()=>navigator.clipboard.writeText(url).then(()=>alert('주소를 복사했습니다.')).catch(()=>alert(url));
    top.appendChild(toolbar);
  }
  new MutationObserver(sync).observe(pageEl,{childList:true,subtree:true});
  setTimeout(sync,100);
})();

// Show the current school's public subdomain beside Student Management.
(function(){
  const nav=document.querySelector('.nav');
  if(!nav||document.getElementById('publicSchoolLink'))return;
  const saved=JSON.parse(localStorage.getItem('globalhub.school')||'null')||{};
  const code=String(saved.domain_name||'abc').trim().toLowerCase();
  if(!/^[a-z]{3,}$/.test(code))return;
  const url='https://'+code+'.creat1324.com';
  const row=document.createElement('div');
  row.id='publicSchoolLink';
  row.style='display:flex;align-items:center;gap:4px;margin:4px 0 8px 8px';
  row.innerHTML='<a href="'+url+'" target="_blank" rel="noopener" title="학생용 하위 도메인 열기" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#365cf5;font-size:12px;text-decoration:none">'+code+'.creat1324.com</a><button type="button" aria-label="하위 도메인 주소 복사" title="주소 복사" style="border:0;background:transparent;color:#365cf5;cursor:pointer;font-size:16px;padding:3px 6px">⧉</button>';
  row.querySelector('button').onclick=async()=>{try{await navigator.clipboard.writeText(url);alert('하위 도메인 주소를 복사했습니다.')}catch(e){alert(url)}};
  const studentButton=nav.querySelector('[data-page="students"]');
  studentButton?.insertAdjacentElement('afterend',row);
})();

// Public school subdomain experience: school -> class -> students.
(function(){
  const host=location.hostname.toLowerCase();
  const match=host.match(/^([a-z]{3,})\.creat1324\.com$/);
  if(!match)return;
  const domain=match[1];
  const css=document.createElement('style');
  css.textContent='.tenant-main{max-width:1180px;margin:auto}.tenant-top{text-align:center;margin:8px 0 34px}.tenant-top h1{font-size:34px;margin:0 0 10px}.tenant-top p{color:#718096;margin:0}.tenant-class-grid{display:grid;grid-template-columns:repeat(3,minmax(150px,190px));justify-content:center;gap:22px}.tenant-class-card{aspect-ratio:1;border:1px solid #dfe4ec;border-radius:16px;background:#fff;box-shadow:0 8px 24px #17203310;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#172033}.tenant-class-card:hover{border-color:#365cf5;box-shadow:0 10px 28px #365cf530;transform:translateY(-2px)}.tenant-class-card strong{font-size:28px;color:#365cf5}.tenant-class-card span{margin-top:10px;color:#718096}.tenant-student-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;max-height:calc(100vh - 250px);overflow-y:auto;padding:4px}.tenant-student-card{border:1px solid #dfe4ec;border-radius:14px;background:#fff;padding:18px;text-align:center}.tenant-student-photo{width:150px;aspect-ratio:1;margin:0 auto 12px;border-radius:12px;background:#dfe7ff;color:#365cf5;display:flex;align-items:center;justify-content:center;font-size:48px;font-weight:700}.tenant-student-card b{display:block;font-size:17px}.tenant-back{margin-bottom:18px}@media(max-width:700px){.tenant-class-grid{grid-template-columns:repeat(2,minmax(130px,180px))}.tenant-student-grid{gap:10px}.tenant-student-card{padding:10px}.tenant-student-photo{width:100%;font-size:32px}}';
  document.head.appendChild(css);
  const pageEl=document.getElementById('page');
  const school=JSON.parse(localStorage.getItem('globalhub.school')||'null')||{};
  const schoolName=school.name||domain.toUpperCase()+' 학교';
  const department=school.department||'학생 관리';
  const source=(window.GLOBALHUB_TEST_DATA&&GLOBALHUB_TEST_DATA.students)||[];
  const students=source.length?source.map((s,i)=>({name:s.name||s[0]||('학생 '+(i+1)),klass:s.klass||s[2]||['A반','B반','C반'][i%3],initial:s.initial||String(s.name||s[0]||'학').charAt(0),photo:s.photo||''})):Array.from({length:9},(_,i)=>({name:'학생 '+(i+1),klass:['A반','B반','C반'][i%3],initial:'학'}));
  let selectedClass='';
  function shell(body){return '<div class="tenant-main">'+body+'</div>'}
  function home(){const groups=[...new Set(students.map(s=>s.klass))];return shell('<div class="tenant-top"><h1>'+schoolName+'</h1><p>'+department+'</p></div><div class="tenant-class-grid">'+groups.map(k=>'<button class="tenant-class-card" onclick="window.tenantSelectClass('+JSON.stringify(k)+')"><strong>'+k+'</strong><span>'+students.filter(s=>s.klass===k).length+'명</span></button>').join('')+'</div>')}
  function classView(){const list=students.filter(s=>s.klass===selectedClass);return shell('<button class="ghost tenant-back" onclick="window.tenantHome()">← 반 목록</button><div class="tenant-top"><h1>'+schoolName+'</h1><p>'+department+' · '+selectedClass+'</p></div><div class="tenant-student-grid">'+list.map(s=>'<article class="tenant-student-card">'+(s.photo?'<img class="tenant-student-photo" src="'+s.photo+'" alt="'+s.name+' 사진">':'<div class="tenant-student-photo">'+s.initial+'</div>')+'<b>'+s.name+'</b></article>').join('')+'</div>')}
  function renderTenant(){if(typeof page!=='undefined'&&page==='tenantClass'){pageEl.innerHTML=classView()}else pageEl.innerHTML=home()}
  window.tenantHome=function(){page='tenantHome';renderTenant()};window.tenantSelectClass=function(k){selectedClass=k;page='tenantClass';renderTenant()};
  document.querySelector('.side')?.remove();document.querySelector('.main')?.classList.add('tenant-main');
  window.tenantHome();
})();

// Keep the survey QR with survey settings instead of school settings.
(function(){
  function syncQr(){
    const pageEl=document.getElementById('page');
    if(!pageEl||typeof page==='undefined')return;
    const existing=document.getElementById('qrCard');
    if(page==='school')return
    if(page!=='settings'||existing)return;
    const token=localStorage.getItem('globalhub.formToken')||crypto.randomUUID().replaceAll('-','').slice(0,16);
    localStorage.setItem('globalhub.formToken',token);
    const card=document.createElement('div');card.id='qrCard';card.className='card';
    card.innerHTML='<h2>학생 기초조사 QR</h2><p class="muted">학교 또는 반별로 하나의 QR을 만들어 배포하세요.</p><div style="padding:10px;background:#f5f7fb;border-radius:8px;word-break:break-all">https://q.creat1324.com/f/'+token+'</div><div style="margin-top:12px"><button class="ghost" onclick="showQr()">QR 보기</button> <button class="ghost" onclick="copyFormUrl()">주소 복사</button> <button class="ghost" onclick="rotateToken()">토큰 재발급</button></div>';
    const firstCard=pageEl.querySelector('.card');firstCard?pageEl.insertBefore(card,firstCard):pageEl.appendChild(card);
  }
  new MutationObserver(syncQr).observe(document.getElementById('page'),{childList:true,subtree:true});
  setTimeout(syncQr,0);
})();
