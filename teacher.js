(function(){
  const nav=document.querySelector('.nav');
  if(!nav||document.querySelector('[data-page="teachers"]'))return;
  const b=document.createElement('button');b.dataset.page='teachers';b.textContent='4. 교사설정';b.onclick=()=>{page='teachers';render()};nav.appendChild(b);
  const oldRender=window.render;
  window.render=function(){
    if(page!=='teachers'){oldRender();return}
    document.querySelectorAll('.nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===page));
    document.getElementById('page').innerHTML='<div class="top"><div><h1>4. 교사설정</h1><span class="muted">교사 계정과 학생 관리 권한을 설정합니다.</span></div></div><div class="card"><div class="field"><label>이름</label><input id="teacherName" placeholder="교사 이름"></div><div class="field"><label>이메일</label><input id="teacherEmail" type="email" placeholder="교사 이메일"></div><div class="field"><label>전화번호 (선택)</label><input id="teacherPhone" type="tel" placeholder="전화번호를 입력하지 않아도 됩니다"></div><div class="field"><label>권한</label><select id="teacherRole"><option>모든</option><option>담임</option><option>학년부장</option><option>상담교사</option><option>학생부장</option><option>없음</option></select></div><button class="primary" id="saveTeacher">교사 정보 저장</button></div><div class="card"><h2>등록된 교사</h2><div id="teacherList" class="muted">저장된 교사 목록을 불러오는 중입니다.</div></div>';
    document.getElementById('saveTeacher').onclick=async()=>{const p={name:teacherName.value,email:teacherEmail.value,phone:teacherPhone.value||null,role:teacherRole.value};if(!p.name||!p.email)return alert('이름과 이메일은 필수입니다.');localStorage.setItem('globalhub.teacher',JSON.stringify(p));try{if(window.supabase&&GLOBALHUB_SUPABASE.anonKey){const c=supabase.createClient(GLOBALHUB_SUPABASE.url,GLOBALHUB_SUPABASE.anonKey);const r=await c.from('teachers').upsert(p,{onConflict:'email'});if(r.error)throw r.error}}catch(e){console.warn(e);return alert('로컬에 저장했습니다. DB 정책 또는 teachers 테이블을 확인해 주세요.')}alert('교사 정보가 저장되었습니다.');loadTeachers()};
    loadTeachers();
  };
  async function loadTeachers(){const el=document.getElementById('teacherList');if(!el)return;let rows=[];try{if(window.supabase&&GLOBALHUB_SUPABASE.anonKey){const c=supabase.createClient(GLOBALHUB_SUPABASE.url,GLOBALHUB_SUPABASE.anonKey);const r=await c.from('teachers').select('name,email,phone,role').order('name');if(!r.error)rows=r.data||[]}}catch(e){}if(!rows.length){const x=localStorage.getItem('globalhub.teacher');if(x)rows=[JSON.parse(x)]}el.innerHTML=rows.length?'<table class="table"><tr><th>이름</th><th>이메일</th><th>전화번호</th><th>권한</th></tr>'+rows.map(x=>'<tr><td>'+x.name+'</td><td>'+x.email+'</td><td>'+(x.phone||'미등록')+'</td><td>'+x.role+'</td></tr>').join('')+'</table>':'등록된 교사가 없습니다.'}
})();
