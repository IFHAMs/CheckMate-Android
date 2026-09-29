const SUPABASE_URL = "https://pnspwtwgvlbhvubzhaij.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_yLAC17MpiJFeTpw8hXmmnQ_msgCtAaz";
const configured = !SUPABASE_URL.startsWith("YOUR_") && !SUPABASE_ANON_KEY.startsWith("YOUR_");
const APP_PIN = "1010";
const sb = configured ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const $ = id => document.getElementById(id);
let authMode="login", currentUser=null, otherUser=null, conversationId=null;
let realtimeChannel=null, presenceChannel=null, cameraStream=null, chess=null, selectedSquare=null, vsRobot=false, robotThinking=false;
let onlineUserIds=new Set();
let archivedOnly=false;
let currentRows=[];
let selectedMessage=null;
let replyToMessage=null;
let typingTimer=null;
let typingSent=false;
let typingChannel=null;
const OFFLINE_QUEUE_KEY="checkmate_offline_messages_v1";

function show(viewId){["authView","gameView","pinView","chatView"].forEach(id=>$(id).classList.toggle("hidden",id!==viewId));}
function status(el,msg=""){ $(el).textContent=msg; }
function isOnline(){return navigator.onLine;}
function isUserOnline(userId){return Boolean(userId && onlineUserIds.has(userId));}
function formatLastSeen(v){if(!v)return"";const d=new Date(v);if(Number.isNaN(d.getTime()))return"";return"last seen "+d.toLocaleString([], {hour:"2-digit",minute:"2-digit",day:"2-digit",month:"short"});}
function updatePresenceUI(){
  const dot=$("chatPresenceDot"), label=$("chatPresenceLabel");
  if(!dot||!label)return;
  const online=isUserOnline(otherUser?.id);
  dot.className="presence-dot "+(online?"online":"offline");
  label.textContent=online?"Online":"Offline";
  if($("lastSeenLabel"))$("lastSeenLabel").textContent=online?"":formatLastSeen(otherUser?.last_seen_at);
}
async function loadOtherProfileMeta(){
  if(!sb||!otherUser?.id)return;
  const {data}=await sb.from("profiles").select("last_seen_at").eq("id",otherUser.id).maybeSingle();
  if(data)otherUser.last_seen_at=data.last_seen_at;
  updatePresenceUI();
}
function refreshPresenceList(){
  document.querySelectorAll("[data-presence-user]").forEach(el=>{
    const online=isUserOnline(el.dataset.presenceUser);
    el.className="presence-dot "+(online?"online":"offline");
    el.title=online?"Online":"Offline";
  });
  updatePresenceUI();
}
async function startPresence(){
  if(!sb||!currentUser)return;
  if(presenceChannel){try{await sb.removeChannel(presenceChannel);}catch{}presenceChannel=null;}
  onlineUserIds=new Set();
  presenceChannel=sb.channel("checkmate-presence",{config:{presence:{key:currentUser.id}}});
  const refresh=()=>{
    const state=presenceChannel.presenceState();
    const ids=new Set(Object.keys(state||{}));
    Object.values(state||{}).flat().forEach(meta=>{if(meta?.user_id)ids.add(meta.user_id);});
    onlineUserIds=ids;
    refreshPresenceList();
  };
  presenceChannel.on("presence",{event:"sync"},refresh);
  presenceChannel.on("presence",{event:"join"},refresh);
  presenceChannel.on("presence",{event:"leave"},refresh);
  await presenceChannel.subscribe(async status=>{
    if(status==="SUBSCRIBED"){
      await sb.from("profiles").update({last_seen_at:new Date().toISOString()}).eq("id",currentUser.id);
      await presenceChannel.track({user_id:currentUser.id,username:currentUser.user_metadata?.username||"",online_at:new Date().toISOString()});
      refresh();
    }
  });
}
function stopPresence(){
  if(presenceChannel&&sb)sb.removeChannel(presenceChannel);
  presenceChannel=null;onlineUserIds=new Set();
}
async function startTypingChannel(){
  if(!sb||!currentUser||!conversationId)return;
  if(typingChannel)sb.removeChannel(typingChannel);
  typingChannel=sb.channel("typing-"+conversationId);
  typingChannel.on("broadcast",{event:"typing"},payload=>{
    if(payload?.payload?.user_id===currentUser.id)return;
    if($("typingLabel"))$("typingLabel").textContent=payload?.payload?.typing?"Typing…":"";
    clearTimeout(typingTimer);
    if(payload?.payload?.typing)typingTimer=setTimeout(()=>{$("typingLabel").textContent=""},1800);
  });
  await typingChannel.subscribe();
}
function sendTypingState(isTyping){
  if(!typingChannel)return;
  typingChannel.send({type:"broadcast",event:"typing",payload:{user_id:currentUser.id,typing:isTyping}});
}
function stopTypingChannel(){
  if(typingChannel&&sb)sb.removeChannel(typingChannel);
  typingChannel=null;clearTimeout(typingTimer);
  if($("typingLabel"))$("typingLabel").textContent="";
}
function queueRead(){try{return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY)||"[]")}catch{return[]}}
function queueWrite(rows){localStorage.setItem(OFFLINE_QUEUE_KEY,JSON.stringify(rows));}
function queueMessage(row){const q=queueRead();q.push(row);queueWrite(q);return row.local_id;}
function setNetworkStatus(){
  const el=$("networkStatus");
  if(!el)return;
  el.textContent=isOnline()?"Online":"Offline — new text messages will sync when internet returns";
  el.className="network-status "+(isOnline()?"online":"offline");
}
window.addEventListener("online",async()=>{setNetworkStatus();await syncOfflineMessages();if(conversationId)await loadMessages();await loadChatList();});
window.addEventListener("offline",()=>setNetworkStatus());

$("toggleAuth").addEventListener("click",()=>{
  authMode=authMode==="login"?"signup":"login";
  $("authTitle").textContent=authMode==="login"?"Sign in":"Create account";
  $("authHint").textContent=authMode==="login"?"Sign in to your account.":"Create your account with a username and password.";
  $("authSubmit").textContent=authMode==="login"?"Sign in":"Create account";
  $("toggleAuth").textContent=authMode==="login"?"Create an account":"Already have an account";
  status("authStatus");
});

$("authForm").addEventListener("submit",async e=>{
  e.preventDefault();
  if(!sb){status("authStatus","Add your Supabase URL and key in app.js first.");return;}
  status("authStatus","Working…");
  const username=$("username").value.trim().toLowerCase(), password=$("password").value;
  if(!/^[a-z0-9_]{3,24}$/.test(username)){status("authStatus","Username must be 3–24 characters using letters, numbers, or underscores.");return;}
  const authEmail=`${username}@auth.checkmate.local`;
  const result=authMode==="login"
    ? await sb.auth.signInWithPassword({email:authEmail,password})
    : await sb.auth.signUp({email:authEmail,password,options:{data:{username}}});
  if(result.error){status("authStatus",result.error.message);return;}
  if(authMode==="signup"&&!result.data.session)status("authStatus","Account created. You can now sign in with your username.");
  else {status("authStatus");await enterApp(result.data.user);}
});

async function enterApp(user){
  currentUser=user;
  const {data:profile}=await sb.from("profiles").select("username").eq("id",user.id).maybeSingle();
  $("userEmail").textContent=profile?.username||user.user_metadata?.username||"";
  show("gameView");initChess();setNetworkStatus();await startPresence();
  if(isOnline())await syncOfflineMessages();
}
async function loadSession(){
  if(!sb){show("authView");return;}
  const {data:{session}}=await sb.auth.getSession();
  if(session?.user)await enterApp(session.user);else show("authView");
}
if(sb)sb.auth.onAuthStateChange(async(_event,session)=>{
  if(session?.user&&!currentUser)await enterApp(session.user);
  if(!session){stopPresence();currentUser=null;cleanupChat();show("authView");}
});
$("logoutBtn").addEventListener("click",()=>sb?.auth.signOut());
$("chatLogoutBtn").addEventListener("click",()=>sb?.auth.signOut());

function initChess(){chess=new Chess();selectedSquare=null;robotThinking=false;renderBoard();updateGameStatus();}
$("newGameBtn").addEventListener("click",initChess);
$("robotBtn").addEventListener("click",()=>{vsRobot=!vsRobot;initChess();$("robotBtn").textContent=vsRobot?"Play Local 2-Player":"Play vs Robot";if(vsRobot) setTimeout(robotMove,250);});
const pieceSymbols={p:"♟",n:"♞",b:"♝",r:"♜",q:"♛",k:"♚"};
function renderBoard(){
  const board=$("board");board.innerHTML="";const position=chess.board();
  for(let row=0;row<8;row++)for(let col=0;col<8;col++){
    const sq=document.createElement("button");sq.type="button";sq.className="square "+((row+col)%2===0?"light":"dark");
    const file=String.fromCharCode(97+col),rank=8-row,name=file+rank;sq.dataset.square=name;
    if(name===selectedSquare)sq.classList.add("selected");
    const piece=position[row][col];if(piece){const span=document.createElement("span");span.className="piece";span.textContent=pieceSymbols[piece.type];span.style.color=piece.color==="w"?"#fff":"#111";sq.appendChild(span);}
    sq.addEventListener("click",()=>handleSquare(name));board.appendChild(sq);
  }
}
function handleSquare(square){
  if(chess.isGameOver()||robotThinking||(vsRobot&&chess.turn()==="b"))return;const piece=chess.get(square);
  if(!selectedSquare){if(piece&&piece.color===chess.turn()){selectedSquare=square;renderBoard();}return;}
  try{chess.move({from:selectedSquare,to:square,promotion:"q"});selectedSquare=null;renderBoard();updateGameStatus();if(vsRobot&&!chess.isGameOver())setTimeout(robotMove,180);}
  catch{if(piece&&piece.color===chess.turn())selectedSquare=square;else selectedSquare=null;renderBoard();}
}
function updateGameStatus(){let s=chess.isCheckmate()?"Checkmate!":chess.isDraw()?"Draw.":chess.isCheck()?"Check!":"";if(!s)s=vsRobot&&chess.turn()==="b"?"Robot is thinking…":(chess.turn()==="w"?"White to move":"Black to move");$("gameStatus").textContent=s;}

function evaluatePosition(){
  if(chess.isCheckmate()) return chess.turn()==="w" ? -100000 : 100000;
  if(chess.isDraw()) return 0;
  const values={p:100,n:320,b:330,r:500,q:900,k:20000};
  let score=0;
  for(const row of chess.board()) for(const piece of row) if(piece) score+=(piece.color==="w"?1:-1)*values[piece.type];
  return score;
}

function minimax(depth, maximizing){
  if(depth===0||chess.isGameOver()) return evaluatePosition();
  const moves=chess.moves({verbose:true});
  let best=maximizing?-Infinity:Infinity;
  for(const move of moves){
    chess.move(move);
    const score=minimax(depth-1,!maximizing);
    chess.undo();
    best=maximizing?Math.max(best,score):Math.min(best,score);
  }
  return best;
}

function robotMove(){
  if(!vsRobot||chess.isGameOver()||chess.turn()!=="b")return;
  robotThinking=true;updateGameStatus();
  const moves=chess.moves({verbose:true});let bestScore=Infinity,bestMoves=[];
  for(const move of moves){
    chess.move(move);
    const score=minimax(2,true);
    chess.undo();
    if(score<bestScore){bestScore=score;bestMoves=[move];}
    else if(score===bestScore)bestMoves.push(move);
  }
  const chosen=bestMoves[Math.floor(Math.random()*bestMoves.length)];
  if(chosen)chess.move(chosen);
  robotThinking=false;renderBoard();updateGameStatus();
}


$("openChatBtn").addEventListener("click",()=>{$("pinInput").value="";status("pinStatus");show("pinView");setTimeout(()=>$('pinInput').focus(),50);});
$("pinForm").addEventListener("submit",e=>{e.preventDefault();if($("pinInput").value===APP_PIN){$("pinInput").value="";status("pinStatus");show("chatView");loadChatList();}else{status("pinStatus","");$("pinInput").select();}});
$("pinBackBtn").addEventListener("click",()=>{$("pinInput").value="";status("pinStatus");show("gameView");});
$("backBtn").addEventListener("click",()=>{cleanupChat();show("gameView");});
$("startChatBtn").addEventListener("click",openConversation);
$("archiveBtn").addEventListener("click",async()=>{archivedOnly=!archivedOnly;$("archiveBtn").textContent=archivedOnly?"← All chats":"🗂 Archive";await loadChatList();});

async function openConversation(){
  if(!sb||!currentUser)return;cleanupChat(false);
  const username=$("partnerUsername").value.trim().toLowerCase();
  if(!username){status("chatStatus","Enter the other person's username.");return;}
  const myUsername=(currentUser.user_metadata?.username||"").toLowerCase();
  if(username===myUsername){status("chatStatus","Use the other person's username.");return;}
  status("chatStatus","Opening conversation…");
  const {data:users,error:userErr}=await sb.rpc("find_user_by_username",{target_username:username});
  if(userErr||!users?.length){status("chatStatus","That account could not be found.");return;}
  otherUser=users[0];
  await loadOtherProfileMeta();
  const {data:conv,error:convErr}=await sb.rpc("get_or_create_conversation",{other_user_id:otherUser.id});
  if(convErr){status("chatStatus",convErr.message);return;}
  conversationId=conv;$("chatPartner").textContent=otherUser.username;updatePresenceUI();
  await loadMessages();await markSeen();subscribeMessages();await startTypingChannel();status("chatStatus");await loadChatList();
}

async function loadChatList(){
  const list=$("chatList");if(!list||!sb||!currentUser)return;
  list.innerHTML='<div class="empty small-empty">Loading chats…</div>';
  const {data:convs,error}=await sb.from("conversations").select("id,user_a,user_b,created_at").or(`user_a.eq.${currentUser.id},user_b.eq.${currentUser.id}`).order("created_at",{ascending:false});
  if(error){list.innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return;}
  if(!convs?.length){list.innerHTML='<div class="empty small-empty">No chats yet.</div>';return;}
  const ids=convs.map(c=>c.id);
  const {data:settings}=await sb.from("conversation_settings").select("conversation_id,archived,last_read_at").eq("user_id",currentUser.id).in("conversation_id",ids);
  const settingMap=new Map((settings||[]).map(x=>[x.conversation_id,x]));
  const otherIds=convs.map(c=>c.user_a===currentUser.id?c.user_b:c.user_a);
  const {data:profiles}=await sb.from("profiles").select("id,username,last_seen_at").in("id",otherIds);
  const names=new Map((profiles||[]).map(p=>[p.id,{username:p.username||"Unknown",last_seen_at:p.last_seen_at}]));
  list.innerHTML="";
  let shown=0;
  for(const c of convs){
    const setting=settingMap.get(c.id)||{};if(Boolean(setting.archived)!==archivedOnly)continue;
    shown++;const otherId=c.user_a===currentUser.id?c.user_b:c.user_a;
    const {data:lastRows}=await sb.from("messages").select("id,body,created_at,sender_id,seen_at,media_type").eq("conversation_id",c.id).order("created_at",{ascending:false}).limit(1);
    const last=lastRows?.[0];
    const {count}=await sb.from("messages").select("id",{count:"exact",head:true}).eq("conversation_id",c.id).neq("sender_id",currentUser.id).is("seen_at",null);
    const item=document.createElement("button");item.type="button";item.className="chat-list-item";
    const meta=names.get(otherId)||{username:"Unknown"};const name=meta.username;const preview=last?(last.media_type?.startsWith("image")?"📷 Photo":last.media_type?.startsWith("video")?"🎥 Video":last.body||"Message"):"No messages yet";
    item.innerHTML=`<span class="chat-avatar">${escapeHtml(name.slice(0,1).toUpperCase())}</span><span class="chat-list-main"><strong>${escapeHtml(name)} <span class="presence-dot ${isUserOnline(otherId)?"online":"offline"}" data-presence-user="${escapeHtml(otherId)}" title="${isUserOnline(otherId)?"Online":"Offline"}"></span></strong><small>${escapeHtml(preview)}</small></span><span class="chat-list-meta"><small>${last?formatTime(last.created_at):""}</small>${count?`<b>${count}</b>`:""}</span>`;
    item.addEventListener("click",async()=>{archivedOnly=false;$("archiveBtn").textContent="🗂 Archive";await openConversationById(c.id,otherId,name);});list.appendChild(item);
  }
  if(!shown)list.innerHTML='<div class="empty small-empty">Nothing here.</div>';
}
async function openConversationById(cid,otherId,name){
  cleanupChat(false);conversationId=cid;otherUser={id:otherId,username:name};await loadOtherProfileMeta();$("chatPartner").textContent=name;updatePresenceUI();await loadMessages();await markSeen();subscribeMessages();await startTypingChannel();
}
function escapeHtml(v){return String(v??"").replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function formatTime(v){const d=new Date(v);return d.toLocaleDateString()===new Date().toLocaleDateString()?d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):d.toLocaleDateString();}

async function loadMessages(){
  if(!conversationId)return;
  const {data,error}=await sb.from("messages").select("*").eq("conversation_id",conversationId).order("created_at",{ascending:true});
  if(error){status("chatStatus",error.message);return;}
  const messageIds=(data||[]).map(x=>x.id);
  const {data:reactions}=messageIds.length?await sb.from("message_reactions").select("message_id,user_id,reaction").in("message_id",messageIds):{data:[]};
  currentRows=(data||[]).map(m=>({...m,reactions:(reactions||[]).filter(r=>r.message_id===m.id)}));
  renderMessages(currentRows);
}
function reactionSummary(reactions){const map=new Map();for(const r of reactions||[])map.set(r.reaction,(map.get(r.reaction)||0)+1);return [...map.entries()].map(([emoji,n])=>`<button type="button" class="reaction-pill" data-reaction="${escapeHtml(emoji)}">${escapeHtml(emoji)} ${n}</button>`).join("");}
function selectMessage(m){selectedMessage=m;$("messageActions").classList.remove("hidden");$("deleteBtn").classList.toggle("hidden",m.sender_id!==currentUser.id);}
function renderMessages(rows){
  const box=$("messages");box.innerHTML="";const local=queueRead().filter(x=>x.conversation_id===conversationId);
  const query=($("messageSearch")?.value||"").trim().toLowerCase();
  const filtered=rows.filter(m=>!query||String(m.body||"").toLowerCase().includes(query));
  if(!filtered.length&&!local.length){box.innerHTML='<div class="empty">No matching messages.</div>';return;}
  for(const m of filtered){
    const div=document.createElement("article");div.className="message "+(m.sender_id===currentUser.id?"mine":"");div.dataset.messageId=m.id;
    if(m.deleted_at){const p=document.createElement("div");p.className="deleted-message";p.textContent="Message deleted";div.appendChild(p);}
    else {
      if(m.reply_to){const target=rows.find(x=>x.id===m.reply_to);if(target){const q=document.createElement("div");q.className="quoted-message";q.textContent=(target.body||"Media message").slice(0,100);div.appendChild(q);}}
      if(m.body){const p=document.createElement("div");p.textContent=m.body;div.appendChild(p);}
      if(m.media_url){if(m.media_type?.startsWith("video")){const v=document.createElement("video");v.controls=true;v.src=m.media_url;div.appendChild(v);}else{const img=document.createElement("img");img.alt="Shared photo";img.src=m.media_url;div.appendChild(img);}}
    }
    const small=document.createElement("small");small.textContent=formatTime(m.created_at)+(m.sender_id===currentUser.id?(m.seen_at?"  • Seen":"  • Sent"):"");div.appendChild(small);
    const actions=document.createElement("button");actions.type="button";actions.className="message-more";actions.textContent="⋯";actions.title="Message actions";actions.addEventListener("click",e=>{e.stopPropagation();selectMessage(m);});
    div.appendChild(actions);
    const reacts=document.createElement("div");reacts.className="reaction-list";reacts.innerHTML=reactionSummary(m.reactions);reacts.querySelectorAll(".reaction-pill").forEach(b=>b.addEventListener("click",()=>toggleReaction(m,b.dataset.reaction)));if(reacts.innerHTML)div.appendChild(reacts);
    let pressTimer;div.addEventListener("pointerdown",()=>{pressTimer=setTimeout(()=>selectMessage(m),500)});div.addEventListener("pointerup",()=>clearTimeout(pressTimer));div.addEventListener("pointercancel",()=>clearTimeout(pressTimer));div.addEventListener("contextmenu",e=>{e.preventDefault();selectMessage(m)});
    box.appendChild(div);
  }
  for(const m of local){const div=document.createElement("article");div.className="message mine pending";const p=document.createElement("div");p.textContent=m.body;div.appendChild(p);const s=document.createElement("small");s.textContent=formatTime(m.created_at)+"  • Pending";div.appendChild(s);box.appendChild(div);}
  box.scrollTop=box.scrollHeight;
}
function subscribeMessages(){
  realtimeChannel=sb.channel("messages-"+conversationId)
    .on("postgres_changes",{event:"*",schema:"public",table:"messages",filter:`conversation_id=eq.${conversationId}`},async()=>{await loadMessages();await markSeen();await loadChatList();})
    .on("postgres_changes",{event:"*",schema:"public",table:"message_reactions"},async()=>{await loadMessages();})
    .subscribe();
}
async function markSeen(){if(!conversationId||!isOnline())return;await sb.rpc("mark_conversation_seen",{cid:conversationId});}
function cleanupChat(reset=true){if(realtimeChannel&&sb){sb.removeChannel(realtimeChannel);realtimeChannel=null;}stopTypingChannel();conversationId=null;otherUser=null;selectedMessage=null;replyToMessage=null;$("messageActions")?.classList.add("hidden");$("replyPreview")?.classList.add("hidden");if(reset){$("messages").innerHTML='<div class="empty">Enter the other person\'s username to open the conversation.</div>';$('chatPartner').textContent="Choose a person";}}

async function makeId(){
  if(window.crypto?.randomUUID)return window.makeId();
  if(window.crypto?.getRandomValues){
    const b=new Uint8Array(16);
    window.crypto.getRandomValues(b);
    b[6]=(b[6]&15)|64;
    b[8]=(b[8]&63)|128;
    return [...b].map((x,i)=>((i===4||i===6||i===8||i===10)?"-":"")+x.toString(16).padStart(2,"0")).join("");
  }
  return Date.now().toString(36)+"-"+Math.random().toString(36).slice(2)+"-"+Math.random().toString(36).slice(2);
}

function sendText(body){
  if(!conversationId||!currentUser)return false;
  const row={local_id:crypto.randomUUID(),conversation_id:conversationId,sender_id:currentUser.id,body,reply_to:replyToMessage?.id||null,created_at:new Date().toISOString()};
  if(!isOnline()){queueMessage(row);renderMessages([]);status("chatStatus","Saved offline. It will send automatically when internet returns.");return true;}
  const {error}=await sb.from("messages").insert({conversation_id:conversationId,sender_id:currentUser.id,body,reply_to:replyToMessage?.id||null});
  if(error){queueMessage(row);status("chatStatus","Saved locally; it will retry when internet returns.");renderMessages([]);return true;}
  return true;
}
async function syncOfflineMessages(){
  if(!sb||!currentUser||!isOnline())return;
  const q=queueRead();if(!q.length)return;const keep=[];
  for(const m of q){
    if(m.sender_id!==currentUser.id){continue;}
    const {error}=await sb.from("messages").insert({conversation_id:m.conversation_id,sender_id:m.sender_id,body:m.body,reply_to:m.reply_to||null});
    if(error)keep.push(m);
  }
  queueWrite(keep);
  if(conversationId)await loadMessages();
}
async function toggleReaction(m,reaction){
  if(!m?.id||!sb)return;
  const {data:existing}=await sb.from("message_reactions").select("message_id").eq("message_id",m.id).eq("user_id",currentUser.id).eq("reaction",reaction).maybeSingle();
  const result=existing?await sb.from("message_reactions").delete().eq("message_id",m.id).eq("user_id",currentUser.id).eq("reaction",reaction):await sb.from("message_reactions").insert({message_id:m.id,user_id:currentUser.id,reaction});
  if(result.error)status("chatStatus",result.error.message);else await loadMessages();
}
function setReply(m){replyToMessage=m;$("replyPreviewText").textContent=(m.body||"Media message").slice(0,120);$("replyPreview").classList.remove("hidden");$("messageInput").focus();$("messageActions").classList.add("hidden");}
$("replyBtn").addEventListener("click",()=>{if(selectedMessage)setReply(selectedMessage);});
$("copyBtn").addEventListener("click",async()=>{if(!selectedMessage)return;try{await navigator.clipboard.writeText(selectedMessage.body||"");status("chatStatus","Copied.");}catch{status("chatStatus","Copy is unavailable in this browser.");}$("messageActions").classList.add("hidden");});
$("deleteBtn").addEventListener("click",async()=>{if(!selectedMessage||selectedMessage.sender_id!==currentUser.id)return;const {error}=await sb.from("messages").update({deleted_at:new Date().toISOString(),body:""}).eq("id",selectedMessage.id).eq("sender_id",currentUser.id);if(error)status("chatStatus",error.message);else await loadMessages();$("messageActions").classList.add("hidden");});
$("closeActionsBtn").addEventListener("click",()=>$("messageActions").classList.add("hidden"));
$("cancelReplyBtn").addEventListener("click",()=>{replyToMessage=null;$("replyPreview").classList.add("hidden");});
document.querySelectorAll(".reaction-btn").forEach(b=>b.addEventListener("click",()=>{if(selectedMessage)toggleReaction(selectedMessage,b.dataset.reaction);}));
$("messageSearch").addEventListener("input",()=>renderMessages(currentRows));
$("messageInput").addEventListener("input",()=>{sendTypingState(true);clearTimeout(typingTimer);typingTimer=setTimeout(()=>sendTypingState(false),1200);});
$("composer").addEventListener("submit",async e=>{e.preventDefault();if(!conversationId){status("chatStatus","Open a conversation first.");return;}const body=$("messageInput").value.trim();if(!body)return;const ok=await sendText(body);if(ok){$("messageInput").value="";replyToMessage=null;$("replyPreview").classList.add("hidden");sendTypingState(false);}});

$("mediaBtn").addEventListener("click",()=>$("mediaInput").click());
$("mediaInput").addEventListener("change",async e=>{const file=e.target.files?.[0];if(file)await uploadMedia(file);e.target.value="";});
async function uploadMedia(file){
  if(!conversationId)return status("chatStatus","Open a conversation first.");
  if(!isOnline())return status("chatStatus","Media needs internet right now. Text messages can be queued offline.");
  if(file.size>50*1024*1024)return status("chatStatus","Please keep media under 50 MB.");
  status("chatStatus","Uploading…");const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");const path=`${currentUser.id}/${makeId()}-${safe}`;
  const {error:uploadErr}=await sb.storage.from("chat-media").upload(path,file,{contentType:file.type,upsert:false});if(uploadErr){status("chatStatus",uploadErr.message);return;}
  const {data:urlData}=sb.storage.from("chat-media").getPublicUrl(path);
  const {error:msgErr}=await sb.from("messages").insert({conversation_id:conversationId,sender_id:currentUser.id,body:"",media_url:urlData.publicUrl,media_type:file.type});
  if(msgErr)status("chatStatus",msgErr.message);else status("chatStatus");
}

$("cameraBtn").addEventListener("click",async()=>{if(!navigator.mediaDevices?.getUserMedia){status("chatStatus","Camera access is not supported here.");return;}try{cameraStream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});$("cameraVideo").srcObject=cameraStream;$("cameraPanel").classList.remove("hidden");}catch{status("chatStatus","Camera permission was denied or unavailable.");}});
$("closeCameraBtn").addEventListener("click",closeCamera);
function closeCamera(){cameraStream?.getTracks().forEach(t=>t.stop());cameraStream=null;$("cameraVideo").srcObject=null;$("cameraPanel").classList.add("hidden");}
$("captureBtn").addEventListener("click",async()=>{const video=$("cameraVideo"),canvas=$("cameraCanvas");if(!video.videoWidth)return;canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext("2d").drawImage(video,0,0);canvas.toBlob(async blob=>{if(blob){await uploadMedia(new File([blob],"camera-photo.jpg",{type:"image/jpeg"}));closeCamera();}},"image/jpeg",.9);});

document.addEventListener("visibilitychange",async()=>{if(document.visibilityState==="hidden"&&sb&&currentUser){await sb.from("profiles").update({last_seen_at:new Date().toISOString()}).eq("id",currentUser.id);}});
window.addEventListener("beforeunload",()=>{if(sb&&currentUser)sb.from("profiles").update({last_seen_at:new Date().toISOString()});});
loadSession();
