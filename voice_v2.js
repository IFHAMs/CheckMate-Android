/* CheckMate voice messages v2. */
(() => {
  const SUPABASE_URL="https://pnspwtwgvlbhvubzhaij.supabase.co";
  const SUPABASE_KEY="sb_publishable_yLAC17MpiJFeTpw8hXmmnQ_msgCtAaz";
  const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
  const $=id=>document.getElementById(id);
  let recorder=null,chunks=[],stream=null,timer=null,started=0;
  function setStatus(msg){const el=$("chatStatus");if(el)el.textContent=msg||"";}
  async function currentUser(){return (await sb.auth.getUser()).data.user;}
  async function partnerConversation(){
    const partner=$("chatPartner")?.textContent?.trim();
    if(!partner||partner==="Choose a person")return null;
    const {data:users}=await sb.rpc("find_user_by_username",{target_username:partner.toLowerCase()});
    if(!users?.[0])return null;
    const {data:conversation}=await sb.rpc("get_or_create_conversation",{other_user_id:users[0].id});
    return conversation||null;
  }
  function timerStart(){started=Date.now();timer=setInterval(()=>{const sec=Math.floor((Date.now()-started)/1000),m=String(Math.floor(sec/60)).padStart(2,"0"),s=String(sec%60).padStart(2,"0");if($("voiceTimer"))$("voiceTimer").textContent=m+":"+s;},500);}
  function timerStop(){clearInterval(timer);timer=null;if($("voiceTimer"))$("voiceTimer").textContent="00:00";}
  function finishUI(){if($("voicePanel"))$("voicePanel").classList.add("hidden");timerStop();}
  async function sendBlob(blob){
    const user=await currentUser(),conversationId=await partnerConversation();
    if(!user||!conversationId)return setStatus("Open a conversation first.");
    const path=user.id+"/"+crypto.randomUUID()+"-voice.webm";
    setStatus("Uploading voice…");
    const {error:uploadError}=await sb.storage.from("chat-media").upload(path,blob,{contentType:blob.type||"audio/webm",upsert:false});
    if(uploadError)return setStatus("Voice upload failed: "+uploadError.message);
    const {data:urlData}=sb.storage.from("chat-media").getPublicUrl(path);
    const {error:msgError}=await sb.from("messages").insert({conversation_id:conversationId,sender_id:user.id,body:"",media_url:urlData.publicUrl,media_type:blob.type||"audio/webm"});
    if(msgError){await sb.storage.from("chat-media").remove([path]);return setStatus("Voice message failed: "+msgError.message);}
    setStatus("");
  }
  async function start(){
    if(recorder)return;
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return setStatus("Voice recording is not supported here.");
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:true});chunks=[];recorder=new MediaRecorder(stream);timerStart();$("voicePanel")?.classList.remove("hidden");
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      recorder.onstop=async()=>{const blob=new Blob(chunks,{type:recorder?.mimeType||"audio/webm"});stream?.getTracks().forEach(t=>t.stop());stream=null;recorder=null;chunks=[];finishUI();if(blob.size)await sendBlob(blob);};
      recorder.start();
    }catch{finishUI();setStatus("Microphone permission was denied or unavailable.");}
  }
  function stop(){if(recorder&&recorder.state!=="inactive")recorder.stop();}
  function cancel(){if(recorder){recorder.onstop=null;try{recorder.stop();}catch{}stream?.getTracks().forEach(t=>t.stop());stream=null;recorder=null;chunks=[];}finishUI();}
  $("voiceBtn")?.addEventListener("click",start);$("stopVoiceBtn")?.addEventListener("click",stop);$("cancelVoiceBtn")?.addEventListener("click",cancel);
})();