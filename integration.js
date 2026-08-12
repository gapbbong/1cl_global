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
    no.value=type.value+String(Math.floor(Math.random()*10000)).padStart(4,'0');
    const inputs=[...document.querySelectorAll('.field input')];
    const payload={name:inputs[0]?.value||'미입력 학교',department:inputs[1]?.value||'',education_type:Number(type.value),class_display:'alpha',class_count:Number(document.getElementById('classCount')?.value||1),school_number:no.value,domain_name:inputs.find(x=>x.pattern)?.value||'demo',countries:[...document.querySelectorAll('#countries input')].map(x=>x.value).filter(Boolean)};
    try{await globalHubDb.saveSchool(payload);alert('학교 설정이 저장되었습니다.')}catch(e){console.error(e);alert('저장 중 오류가 발생했습니다. Supabase RLS 정책을 확인해 주세요.')}
  };
})();
