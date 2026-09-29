/* CheckMate v2 runtime polish: reliable archive action + automatic chat lock. */
(() => {
  const SUPABASE_URL="https://pnspwtwgvlbhvubzhaij.supabase.co";
  const SUPABASE_KEY="sb_publishable_yLAC17MpiJFeTpw8hXmmnQ_msgCtAaz";
  const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
  let lockTimer=null;
  async function getCurrentUser(){return (await sb.auth.getUser()).data.user;}
  async function getOpenConversation(){
    const partner=document.getElementById("chatPartner")?.textContent?.trim();
    if(!partner||partner==="Choose a person")return null;
    const user=await getCurrentUser();if(!user)return null;
    const {data:users}=await sb.rpc("find_user_by_username",{target_username:partner.toLowerCase()});
    if(!users?.[0])return null;
    const {data:conversation}=await sb.rpc("get_or_create_conversation",{other_user_id:users[0].id});
    return conversation?{user,conversation}:null;
  }
  const archiveBtn=document.getElementById("archiveBtn");
  archiveBtn?.addEventListener("click",async e=>{
    const open=await getOpenConversation();
    if(!open)return;
    e.preventDefault();e.stopImmediatePropagation();
    const {data:row}=await sb.from("conversation_settings").select("archived").eq("user_id",open.user.id).eq("conversation_id",open.conversation).maybeSingle();
    const next=!Boolean(row?.archived);
    const {error}=await sb.from("conversation_settings").upsert({user_id:open.user.id,conversation_id:open.conversation,archived:next,updated_at:new Date().toISOString()},{onConflict:"user_id,conversation_id"});
    const el=document.getElementById("chatStatus");
    if(error){if(el)el.textContent=error.message;return;}
    if(el)el.textContent=next?"Chat archived.":"Chat unarchived.";
    archiveBtn.textContent="🗂 Archive";
    if(typeof window.loadChatList==="function")await window.loadChatList();
  },true);
  function armLock(){
    clearTimeout(lockTimer);
    lockTimer=setTimeout(()=>{
      const chat=document.getElementById("chatView");
      if(chat&&!chat.classList.contains("hidden")){
        document.getElementById("backBtn")?.click();
        const el=document.getElementById("chatStatus");if(el)el.textContent="Chat locked after inactivity.";
      }
    },10*60*1000);
  }
  ["pointerdown","keydown","touchstart","scroll"].forEach(ev=>document.addEventListener(ev,()=>{
    const chat=document.getElementById("chatView");if(chat&&!chat.classList.contains("hidden"))armLock();
  },{passive:true}));
  document.addEventListener("visibilitychange",()=>{
    const chat=document.getElementById("chatView");if(document.visibilityState==="visible"&&chat&&!chat.classList.contains("hidden"))armLock();
  });
})();