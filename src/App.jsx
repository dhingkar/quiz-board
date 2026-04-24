import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useState, useCallback, useEffect, useRef } from "react";
import { auth, googleProvider, db } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile } from "firebase/auth";
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc } from "firebase/firestore";
const storage = getStorage();

/* ═══ THEME ═══ */
const PC = ["#d4a017","#c43040","#1a8faa","#6c4dcf","#04a87e","#d4622b","#8b5cf6","#0891b2","#be185d","#65a30d"];
const T = {
  bg:"#f4f3f0",surface:"#ffffff",surfaceAlt:"#fafaf8",
  border:"#e6e4df",borderLight:"#eeece8",
  text:"#1c1917",textSoft:"#78716c",textMuted:"#a8a29e",
  danger:"#dc2626",success:"#04a87e",
  radius:16,radiusSm:10,
  font:"'Outfit','Segoe UI',-apple-system,BlinkMacSystemFont,sans-serif",
  fontMono:"'JetBrains Mono','SF Mono',monospace",
};
const FL="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap";
function injectFont(){if(!document.querySelector(`link[href*="Outfit"]`)){const l=document.createElement("link");l.rel="stylesheet";l.href=FL;document.head.appendChild(l);}}

/* ═══ HELPERS ═══ */
function shuffle(a){const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]]}return b}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
function ytId(u){if(!u)return null;const m=u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);return m?m[1]:null}

/* ═══ THEME CSS HELPERS ═══ */
function bgCss(theme){
  if(!theme)return null;
  const t=theme.bgType||"solid";
  if(t==="image"&&theme.bgImageUrl)return`url(${theme.bgImageUrl}) center/cover no-repeat`;
  if(t==="gradient"&&theme.bgColor)return`linear-gradient(${theme.bgGradientAngle||135}deg, ${theme.bgColor}, ${theme.bgColor2||theme.bgColor})`;
  if(theme.bgColor)return theme.bgColor;
  return null;
}
function cellBgCss(cellData,theme,fallback){
  // Per-cell override first
  if(cellData?.bgOverride){
    if(cellData.bgOverrideType==="gradient"&&cellData.bgOverride2){
      return`linear-gradient(${cellData.bgOverrideAngle||135}deg, ${cellData.bgOverride}, ${cellData.bgOverride2})`;
    }
    return cellData.bgOverride;
  }
  // Theme bulk setting
  if(theme?.cellType==="gradient"&&theme?.cellBg&&theme?.cellBg2){
    return`linear-gradient(${theme.cellGradientAngle||135}deg, ${theme.cellBg}, ${theme.cellBg2})`;
  }
  if(theme?.cellBg)return theme.cellBg;
  return fallback;
}

/* ═══ FIRESTORE PERSISTENCE ═══ */
async function loadGamesFromDB(userId){
  try{
    const snap=await getDocs(collection(db,"users",userId,"games"));
    return snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){console.error("Load error:",e);return[]}
}
async function saveGameToDB(userId,game){
  try{await setDoc(doc(db,"users",userId,"games",game.id),game)}
  catch(e){console.error("Save error:",e)}
}
async function deleteGameFromDB(userId,gameId){
  try{await deleteDoc(doc(db,"users",userId,"games",gameId))}
  catch(e){console.error("Delete error:",e)}
}
// Public sharing
async function publishGame(userId,game){
  try{
    const publicGame={...game,_ownerId:userId,_publishedAt:Date.now()};
    await setDoc(doc(db,"public",game.id),publicGame);
    return true;
  }catch(e){console.error("Publish error:",e);alert("Failed to publish: "+e.message);return false}
}
async function unpublishGame(gameId){
  try{await deleteDoc(doc(db,"public",gameId));return true}
  catch(e){console.error("Unpublish error:",e);return false}
}
async function loadPublicGame(gameId){
  try{
    const snap=await getDoc(doc(db,"public",gameId));
    if(snap.exists())return{id:snap.id,...snap.data()};
    return null;
  }catch(e){console.error("Load public error:",e);return null}
}
// Fallback localStorage for offline/unauthenticated use
function loadGamesLocal(){try{const s=localStorage.getItem("qb_games");if(s)return JSON.parse(s)}catch(e){}return[]}
function saveGamesLocal(g){try{localStorage.setItem("qb_games",JSON.stringify(g))}catch(e){}}

const DG={name:"Untitled Game",columns:5,rows:5,timerSeconds:0,
  categories:PC.slice(0,5).map((c,i)=>({name:`Category ${i+1}`,color:c})),boxes:[],
  theme:{
    // Background
    bgType:"solid", // "solid" | "gradient" | "image"
    bgColor:"",
    bgColor2:"",
    bgGradientAngle:135,
    bgImageUrl:"",
    bgOpacity:1,
    // Cell appearance (bulk)
    cellType:"solid", // "solid" | "gradient"
    cellBg:"",
    cellBg2:"",
    cellGradientAngle:135,
    cellOpacity:1,
    cellBorder:"",
    cellShadow:false,
    // Game settings (per-game)
    autoFit:false,
    showScoreboard:false,
    pointStep:100,
  }};

/* ═══ RICH TEXT ═══
   We store HTML strings. The editor uses contentEditable divs.
   Play mode renders via dangerouslySetInnerHTML.
*/
function RichInput({value,onChange,placeholder,style={}}){
  const ref=useRef(null);
  const isLocal=useRef(false);
  // Only set innerHTML on mount or when value changes from outside (not from our own typing)
  useEffect(()=>{
    if(isLocal.current){isLocal.current=false;return}
    if(ref.current&&ref.current.innerHTML!==value){
      ref.current.innerHTML=value||"";
    }
  },[value]);
  const handleInput=()=>{
    isLocal.current=true;
    onChange(ref.current?.innerHTML||"");
  };
  const isEmpty=!value||value===""||value==="<br>";
  return(
    <div style={{position:"relative"}}>
      {isEmpty&&<div style={{position:"absolute",top:0,left:0,color:T.textMuted,pointerEvents:"none",padding:style.padding||"10px 12px",fontSize:style.fontSize||13}}>{placeholder}</div>}
      <div ref={ref} contentEditable suppressContentEditableWarning
        onInput={handleInput}
        style={{
          border:`1.5px solid ${T.borderLight}`,borderRadius:8,fontSize:13,outline:"none",
          fontFamily:T.font,color:T.text,background:T.surfaceAlt,
          minHeight:60,maxHeight:200,overflowY:"auto",padding:"10px 12px",lineHeight:1.5,
          ...style,
        }}
      />
    </div>
  );
}

function FormatBar({targetRef}){
  const exec=(cmd,val)=>{document.execCommand(cmd,false,val);targetRef?.current?.focus()};
  const bs={background:"none",border:`1px solid ${T.borderLight}`,borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:13,fontFamily:T.font,color:T.textSoft,lineHeight:1,marginRight:3};
  return(
    <div style={{display:"flex",gap:2,marginBottom:4,flexWrap:"wrap"}}>
      <button style={{...bs,fontWeight:700}} onClick={()=>exec("bold")} title="Bold">B</button>
      <button style={{...bs,fontStyle:"italic"}} onClick={()=>exec("italic")} title="Italic">I</button>
      <button style={{...bs,textDecoration:"underline"}} onClick={()=>exec("underline")} title="Underline">U</button>
      <button style={{...bs}} onClick={()=>exec("strikeThrough")} title="Strikethrough">S̶</button>
    </div>
  );
}

function ImageUpload({value,onChange,label,color,borderColor}){
  const fileRef=useRef(null);
  const[compressing,setCompressing]=useState(false);
  const isBase64=value&&value.startsWith("data:");

  const compressImage=(file)=>{
    return new Promise((resolve)=>{
      const img=new Image();
      const url=URL.createObjectURL(file);
      img.onload=()=>{
        URL.revokeObjectURL(url);
        const MAX=1920;
        let w=img.width,h=img.height;
        if(w>MAX||h>MAX){
          if(w>h){h=Math.round(h*(MAX/w));w=MAX}
          else{w=Math.round(w*(MAX/h));h=MAX}
        }
        const canvas=document.createElement("canvas");
        canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext("2d");
        ctx.drawImage(img,0,0,w,h);
        // Try JPEG first, fall back to PNG for transparency
        let result=canvas.toDataURL("image/jpeg",0.82);
        if(file.type==="image/png"){
          const pngResult=canvas.toDataURL("image/png");
          // Use PNG only if it's smaller (rare) or if transparency matters
          if(pngResult.length<result.length)result=pngResult;
        }
        resolve(result);
      };
      img.onerror=()=>{
        URL.revokeObjectURL(url);
        // Fallback: read as-is
        const r=new FileReader();r.onload=ev=>resolve(ev.target.result);r.readAsDataURL(file);
      };
      img.src=url;
    });
  };

  const handleFile = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  e.target.value = "";
  setCompressing(true);

  try {
    const compressed = await compressImage(file);

    // convert base64 → blob
    const res = await fetch(compressed);
    const blob = await res.blob();

    const user = auth.currentUser;
    if (!user) {
      alert("You must be logged in to upload images.");
      setCompressing(false);
      return;
    }

    const fileRef = ref(
      storage,
      `users/${user.uid}/${Date.now()}-${file.name}`
    );

    await uploadBytes(fileRef, blob);
    const url = await getDownloadURL(fileRef);

    onChange(url); // ✅ store URL instead of base64

  } catch (err) {
    alert("Failed to upload image: " + err.message);
  }

  setCompressing(false);
};

  const sizeKB=isBase64?Math.round(value.length*0.75/1024):0;

  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
        <span style={{fontSize:10,fontWeight:700,color:color||"#1a8faa",textTransform:"uppercase",letterSpacing:1}}>{label||"🖼 Image"}</span>
        <div style={{flex:1}}/>
        {isBase64&&<span style={{fontSize:10,color:T.success,fontWeight:600}}>✓ Embedded ({sizeKB>1024?(sizeKB/1024).toFixed(1)+"MB":sizeKB+"KB"})</span>}
        {compressing&&<span style={{fontSize:10,color:"#1a8faa",fontWeight:600}}>Compressing…</span>}
        {value&&<button onClick={()=>onChange("")} style={{background:"none",border:"none",fontSize:11,color:T.danger,cursor:"pointer",fontFamily:T.font,fontWeight:600}}>Remove</button>}
      </div>
      <div style={{display:"flex",gap:6}}>
        <input value={isBase64?"(embedded image)":value||""} onChange={e=>onChange(e.target.value)} readOnly={isBase64}
          placeholder="Paste URL or upload file →" style={{flex:1,padding:"8px 12px",border:`1.5px solid ${borderColor||T.borderLight}`,borderRadius:8,fontSize:13,outline:"none",fontFamily:T.font,color:isBase64?T.textMuted:T.text,background:T.surfaceAlt}}/>
        <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleFile}/>
        <button onClick={()=>fileRef.current?.click()} disabled={compressing} style={{padding:"6px 12px",border:`1.5px solid ${borderColor||T.borderLight}`,borderRadius:8,fontSize:12,fontWeight:600,cursor:compressing?"wait":"pointer",background:T.surface,color:T.textSoft,fontFamily:T.font,whiteSpace:"nowrap",flexShrink:0}}>{compressing?"…":"Upload"}</button>
      </div>
      {value&&<div style={{marginTop:6}}><img src={value} alt="" style={{maxWidth:"100%",maxHeight:100,borderRadius:8,objectFit:"contain",border:`1px solid ${T.borderLight}`}} onError={e=>{e.target.style.display="none"}}/></div>}
    </div>
  );
}

/* ═══ BTN ═══ */
function Btn({children,onClick,variant="default",style={},...props}){
  const base={fontFamily:T.font,fontWeight:600,fontSize:14,cursor:"pointer",borderRadius:50,transition:"all 0.15s",display:"inline-flex",alignItems:"center",gap:6,whiteSpace:"nowrap",border:"none",padding:"10px 22px",lineHeight:1};
  const v={default:{background:T.surface,color:T.text,border:`1.5px solid ${T.border}`},primary:{background:T.text,color:"#fff"},danger:{background:"transparent",color:T.danger,border:`1.5px solid ${T.danger}33`},ghost:{background:"transparent",color:T.textSoft,padding:"8px 14px"},success:{background:T.success,color:"#fff"}};
  return <button onClick={onClick} style={{...base,...v[variant],...style}} {...props}>{children}</button>;
}

/* ═══ MEDIA ═══ */
function MediaPreview({imageUrl,videoUrl,answerImageUrl,showAnswerImg,maxHeight="40vh"}){
  const yt=ytId(videoUrl);
  const hasMedia=imageUrl||yt||(showAnswerImg&&answerImageUrl);
  if(!hasMedia)return null;
  return(
    <div style={{marginTop:"2vh",display:"flex",flexDirection:"column",alignItems:"center",gap:"2vh"}}>
      {imageUrl&&<img src={imageUrl} alt="" style={{maxWidth:"100%",maxHeight,borderRadius:12,objectFit:"contain",border:`1px solid ${T.borderLight}`}} onError={e=>{e.target.style.display="none"}}/>}
      {yt&&<div style={{width:"100%",maxWidth:640,aspectRatio:"16/9",borderRadius:12,overflow:"hidden",border:`1px solid ${T.borderLight}`}}><iframe src={`https://www.youtube.com/embed/${yt}`} title="Video" style={{width:"100%",height:"100%",border:"none"}} allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowFullScreen/></div>}
      {showAnswerImg&&answerImageUrl&&<img src={answerImageUrl} alt="" style={{maxWidth:"100%",maxHeight,borderRadius:12,objectFit:"contain",border:`1px solid ${T.success}44`}} onError={e=>{e.target.style.display="none"}}/>}
    </div>
  );
}

/* ═══ TIMER ═══ */
function Timer({seconds}){
  const[left,setLeft]=useState(seconds);const ref=useRef(null);
  useEffect(()=>{if(seconds<=0)return;setLeft(seconds);ref.current=setInterval(()=>setLeft(p=>{if(p<=1){clearInterval(ref.current);return 0}return p-1}),1000);return()=>clearInterval(ref.current)},[seconds]);
  if(seconds<=0)return null;const pct=left/seconds;const color=pct>.3?T.text:T.danger;
  return(<div style={{display:"flex",alignItems:"center",gap:12,marginTop:"2vh"}}><div style={{flex:1,height:6,background:T.borderLight,borderRadius:3,overflow:"hidden"}}><div style={{width:`${pct*100}%`,height:"100%",background:color,borderRadius:3,transition:"width 1s linear,background .3s"}}/></div><span style={{fontFamily:T.fontMono,fontWeight:700,fontSize:"clamp(1rem,2.5vh,1.6rem)",color,minWidth:50,textAlign:"right"}}>{Math.floor(left/60)}:{String(left%60).padStart(2,"0")}</span></div>);
}

/* ═══ AUTO-FIT TEXT ═══
   Shrinks text until it fits within parent without scrolling.
   Uses a ref to measure and binary-search the right font size.
*/
function AutoFitText({html,baseSizePx=80,minSizePx=14,style={}}){
  const outerRef=useRef(null);const innerRef=useRef(null);const[fs,setFs]=useState(baseSizePx);
  useEffect(()=>{
    if(!outerRef.current||!innerRef.current)return;
    let lo=minSizePx,hi=baseSizePx,best=minSizePx;
    const el=innerRef.current;const ct=outerRef.current;
    for(let i=0;i<25;i++){
      const mid=Math.floor((lo+hi)/2);el.style.fontSize=mid+"px";
      if(el.scrollHeight<=ct.clientHeight&&el.scrollWidth<=ct.clientWidth){best=mid;lo=mid+1}else{hi=mid-1}
    }
    setFs(best);
  },[html,baseSizePx]);
  return(
    <div ref={outerRef} style={{width:"100%",overflow:"hidden",...style}}>
      <div ref={innerRef} style={{fontSize:fs,lineHeight:1.3,color:T.text,fontWeight:700,letterSpacing:-.5,fontFamily:T.font,wordBreak:"break-word"}} dangerouslySetInnerHTML={{__html:html}}/>
    </div>
  );
}
function Scoreboard({scores,setScores,pointStep}){
  const[newName,setNewName]=useState("");const step=pointStep||100;const half=Math.round(step/2);
  const add=()=>{if(newName.trim()){setScores(p=>[...p,{name:newName.trim(),score:0}]);setNewName("")}};
  const upd=(i,d)=>setScores(p=>p.map((s,j)=>j===i?{...s,score:s.score+d}:s));
  const rm=i=>setScores(p=>p.filter((_,j)=>j!==i));
  return(<div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"10px 14px",flexShrink:0}}>
    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}><span style={{fontWeight:700,fontSize:12,color:T.textSoft,textTransform:"uppercase",letterSpacing:1}}>Scores</span><div style={{flex:1}}/><input value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&add()} placeholder="Add player/team" style={{padding:"5px 10px",border:`1.5px solid ${T.borderLight}`,borderRadius:8,fontSize:12,outline:"none",fontFamily:T.font,width:140,background:T.surfaceAlt}}/><Btn variant="ghost" onClick={add} style={{fontSize:11,padding:"5px 10px"}}>+</Btn></div>
    {scores.length>0&&<div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>{[...scores].sort((a,b)=>b.score-a.score).map((s,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:4,background:T.bg,borderRadius:8,padding:"4px 8px",fontSize:13}}><span style={{fontWeight:700}}>{s.name}</span><span style={{fontFamily:T.fontMono,fontWeight:800,fontSize:15,minWidth:28,textAlign:"center"}}>{s.score}</span><button onClick={()=>upd(i,-step)} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:T.danger,padding:"0 1px",lineHeight:1}} title={`−${step}`}>−</button><button onClick={()=>upd(i,half)} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:T.textMuted,padding:"0 1px",lineHeight:1,fontWeight:700}} title={`+${half}`}>+½</button><button onClick={()=>upd(i,step)} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,color:T.success,padding:"0 1px",lineHeight:1}} title={`+${step}`}>+</button><button onClick={()=>rm(i)} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:T.textMuted,padding:"0 1px",lineHeight:1}}>×</button></div>))}</div>}
  </div>);
}

/* ═══ SETTINGS DROPDOWN ═══ */
function SettingsDropdown({showSB,setShowSB,pointStep,setPointStep,autoFit,setAutoFit}){
  const[open,setOpen]=useState(false);const ref=useRef(null);
  useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false)};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h)},[]);
  return(<div ref={ref} style={{position:"relative"}}><Btn variant="ghost" onClick={()=>setOpen(!open)} style={{fontSize:12,padding:"6px 10px"}}>⚙</Btn>
    {open&&<div style={{position:"absolute",top:"100%",right:0,marginTop:6,zIndex:100,background:T.surface,border:`1px solid ${T.border}`,borderRadius:14,padding:16,minWidth:220,boxShadow:"0 8px 30px rgba(0,0,0,.1)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}><span style={{fontSize:13,fontWeight:700,color:T.text}}>Scoreboard</span>
        <button onClick={()=>setShowSB(!showSB)} style={{width:42,height:24,borderRadius:12,border:"none",cursor:"pointer",background:showSB?T.success:T.border,position:"relative",transition:"background .2s"}}><div style={{width:18,height:18,borderRadius:9,background:"#fff",position:"absolute",top:3,left:showSB?21:3,transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,.15)"}}/></button></div>
      {showSB&&<div><span style={{fontSize:12,fontWeight:600,color:T.textSoft}}>Point increment</span><div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>{[5,10,25,50,100,200,500].map(v=><button key={v} onClick={()=>setPointStep(v)} style={{padding:"5px 10px",borderRadius:8,fontSize:12,fontWeight:700,fontFamily:T.fontMono,cursor:"pointer",border:"none",background:pointStep===v?T.text:T.bg,color:pointStep===v?"#fff":T.textSoft,transition:"all .1s"}}>{v}</button>)}</div><p style={{fontSize:11,color:T.textMuted,marginTop:8}}>+ adds {pointStep}, +½ adds {Math.round(pointStep/2)}</p></div>}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:14,paddingTop:14,borderTop:`1px solid ${T.borderLight}`}}><div><span style={{fontSize:13,fontWeight:700,color:T.text}}>Auto-fit text</span><p style={{fontSize:11,color:T.textMuted,marginTop:2}}>Shrink question to fit screen</p></div>
        <button onClick={()=>setAutoFit(!autoFit)} style={{width:42,height:24,borderRadius:12,border:"none",cursor:"pointer",background:autoFit?T.success:T.border,position:"relative",transition:"background .2s"}}><div style={{width:18,height:18,borderRadius:9,background:"#fff",position:"absolute",top:3,left:autoFit?21:3,transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,.15)"}}/></button></div>
    </div>}
  </div>);
}

/* ═══ HTML EXPORT ═══ */
async function fetchImageAsDataUrl(url){
  if(!url||url.startsWith("data:"))return{ok:true,data:url};
  // Method 1: direct fetch (works if bucket CORS is configured)
  try{
    const res=await fetch(url,{mode:"cors",cache:"no-cache"});
    if(!res.ok)throw new Error("HTTP "+res.status);
    const blob=await res.blob();
    const data=await new Promise((resolve,reject)=>{
      const r=new FileReader();
      r.onload=()=>resolve(r.result);
      r.onerror=()=>reject(r.error);
      r.readAsDataURL(blob);
    });
    return{ok:true,data};
  }catch(e1){
    console.warn("fetch() failed for",url,e1);
    // Method 2: image + canvas (works if image server allows crossOrigin)
    try{
      const img=await new Promise((resolve,reject)=>{
        const im=new Image();
        im.crossOrigin="anonymous";
        im.onload=()=>resolve(im);
        im.onerror=(err)=>reject(err);
        im.src=url;
      });
      const canvas=document.createElement("canvas");
      canvas.width=img.naturalWidth;
      canvas.height=img.naturalHeight;
      const ctx=canvas.getContext("2d");
      ctx.drawImage(img,0,0);
      const data=canvas.toDataURL("image/jpeg",0.85);
      return{ok:true,data};
    }catch(e2){
      console.warn("canvas fallback also failed for",url,e2);
      return{ok:false,data:url,error:e2.message||e1.message||"unknown"};
    }
  }
}

async function exportGameHTML(game){
  const allImageUrls=[];
  game.boxes.forEach(b=>{
    if(b.imageUrl)allImageUrls.push(b.imageUrl);
    if(b.answerImageUrl)allImageUrls.push(b.answerImageUrl);
  });
  if(game.theme?.bgImageUrl)allImageUrls.push(game.theme.bgImageUrl);

  const uniqueUrls=[...new Set(allImageUrls)];
  const total=uniqueUrls.length;
  let done=0;
  const showProgress=(msg)=>{
    let el=document.getElementById("__exportProgress");
    if(!el){
      el=document.createElement("div");
      el.id="__exportProgress";
      el.style.cssText="position:fixed;top:20px;right:20px;background:#1c1917;color:#fff;padding:14px 20px;border-radius:10px;font-family:'Outfit',sans-serif;font-size:14px;font-weight:600;z-index:99999;box-shadow:0 8px 30px rgba(0,0,0,.3)";
      document.body.appendChild(el);
    }
    el.textContent=msg;
  };
  const hideProgress=()=>{const el=document.getElementById("__exportProgress");if(el)el.remove()};

  if(total>0)showProgress(`Embedding images for offline use… 0/${total}`);

  // Build a URL→{ok,data} map
  const urlMap={};
  const failed=[];
  for(const url of uniqueUrls){
    const result=await fetchImageAsDataUrl(url);
    urlMap[url]=result;
    if(!result.ok)failed.push(url);
    done++;
    showProgress(`Embedding images for offline use… ${done}/${total}`);
  }

  // Clone game with embedded images
  const embeddedGame=JSON.parse(JSON.stringify(game));
  embeddedGame.boxes.forEach(b=>{
    if(b.imageUrl&&urlMap[b.imageUrl])b.imageUrl=urlMap[b.imageUrl].data;
    if(b.answerImageUrl&&urlMap[b.answerImageUrl])b.answerImageUrl=urlMap[b.answerImageUrl].data;
  });
  if(embeddedGame.theme?.bgImageUrl&&urlMap[embeddedGame.theme.bgImageUrl]){
    embeddedGame.theme.bgImageUrl=urlMap[embeddedGame.theme.bgImageUrl].data;
  }

  hideProgress();

  if(failed.length>0){
    const msg=`⚠️ ${failed.length} of ${total} image(s) could not be embedded and will still use URLs (requires internet to load).\n\nThis is usually caused by Firebase Storage CORS. Go to Firebase Console → Storage → Rules tab → check that "read" is public, OR run:\n\ngsutil cors set cors.json gs://quiz-board-claude.firebasestorage.app\n\n(where cors.json allows GET from all origins)\n\nExport the HTML anyway?`;
    if(!window.confirm(msg))return;
  }

  generateHTMLFile(embeddedGame);
}

function generateHTMLFile(game){
  const d=JSON.stringify(game).replace(/<\/script>/gi,"<\\/script>");
  const html=`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${(game.name||"Quiz Board").replace(/</g,"&lt;")}</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;font-family:'Outfit','Segoe UI',sans-serif;overflow:hidden}
.page{position:fixed;inset:0;display:flex;flex-direction:column;padding:1vh 1.5vw;background:#f4f3f0;overflow:hidden}
.topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:.6vh;flex-shrink:0;gap:6px}
.topbar h1{font-size:2.4vh;font-weight:800;letter-spacing:-.5px;color:#1c1917}
.gwrap{flex:1;position:relative;min-height:0}
.grid{position:absolute;inset:0;display:grid}
.cell{background:#fff;border:1px solid #e6e4df;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.3vh;cursor:pointer;transition:transform .12s,box-shadow .12s,opacity .2s;user-select:none;overflow:hidden}
.cell:hover:not(.v){transform:scale(1.03);box-shadow:0 4px 16px rgba(0,0,0,.08)}
.cell.v{opacity:.2;background:#e5e4e0;cursor:default}.cell.v span{text-decoration:line-through;text-decoration-color:#c43040;text-decoration-thickness:2.5px}
.pill{font-family:inherit;font-weight:600;font-size:12px;cursor:pointer;border-radius:50px;transition:all .15s;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;border:1.5px solid #e6e4df;background:#fff;color:#1c1917;padding:6px 12px;line-height:1}
.qpage{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;padding:1.5vh 1.5vw;background:#f4f3f0;overflow:hidden}
.qcard{background:#fff;border:1px solid #e6e4df;border-radius:20px;padding:2vh 2.5vw;max-width:1200px;width:100%;text-align:center;box-shadow:0 12px 60px rgba(0,0,0,.06);display:flex;flex-direction:column;align-items:center;overflow:hidden;max-height:82vh}
.acard{background:#f0faf6;border:1.5px solid rgba(4,168,126,.2);border-radius:20px;padding:2.5vh 2.5vw;max-width:1200px;width:100%;text-align:center;display:flex;flex-direction:column;align-items:center;overflow:hidden;max-height:84vh}
.reveal-btn{margin-top:1.5vh;padding:10px 28px;font-size:clamp(.8rem,1.8vh,1.1rem);font-weight:700;font-family:inherit;cursor:pointer;border-radius:50px;transition:all .15s;flex-shrink:0}
.answer-box{margin-top:1.5vh;padding:1.5vh 2vw;background:#f0faf6;border-radius:12px;border:1.5px solid rgba(4,168,126,.2);width:100%;flex-shrink:0}
.timer-bar{margin-top:1.5vh;display:flex;align-items:center;gap:12px;width:100%;flex-shrink:0}
.timer-track{flex:1;height:6px;background:#eeece8;border-radius:3px;overflow:hidden}
.timer-fill{height:100%;border-radius:3px;transition:width 1s linear,background .3s}
.media{margin-top:1.5vh;display:flex;flex-direction:column;align-items:center;gap:1.5vh;flex-shrink:0;max-height:20vh;overflow:hidden}
.media img{max-width:100%;max-height:20vh;border-radius:10px;object-fit:contain;border:1px solid #eeece8}
.media .yt{width:100%;max-width:400px;aspect-ratio:16/9;border-radius:10px;overflow:hidden;border:1px solid #eeece8}
.media .yt iframe{width:100%;height:100%;border:none}
.hidden{display:none!important}
.q-btns{display:flex;gap:12px;flex-shrink:0;justify-content:center;padding-top:.8vh}
.hint{color:#a8a29e;font-size:11px;margin-top:6px;text-align:center;flex-shrink:0}
.fittext{width:100%;overflow:hidden;flex:0 1 auto}
.fittext-inner{line-height:1.3;color:#1c1917;font-weight:700;letter-spacing:-.5px;word-break:break-word}
</style></head><body>
<div class="page" id="gridPage">
<div id="bgLayer" style="position:absolute;inset:0;pointer-events:none;z-index:0"></div>
<div class="topbar" style="position:relative;z-index:1"><div style="display:flex;align-items:center;gap:8px"><h1>${(game.name||"Quiz").replace(/</g,"&lt;")}</h1></div>
<div style="display:flex;gap:4px"><button class="pill" onclick="scramble()">Scramble</button><button class="pill" style="border-color:#dc2626;color:#dc2626" onclick="resetBoard()">Reset</button><button class="pill" onclick="toggleFS()">⛶</button></div></div>
<div class="gwrap" style="position:relative;z-index:1"><div class="grid" id="grid"></div></div></div>
<div class="qpage hidden" id="qPage">
<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:0;width:100%">
<div class="qcard" id="qCard">
<div id="qCat" style="font-weight:800;font-size:clamp(.8rem,2.2vh,1.3rem);text-transform:uppercase;letter-spacing:3px;margin-bottom:.3vh;flex-shrink:0"></div>
<div id="qSub" style="font-weight:500;font-size:clamp(.7rem,1.8vh,1rem);color:#78716c;margin-bottom:1.5vh;flex-shrink:0"></div>
<div class="fittext" id="qFit" style="max-height:40vh"><div class="fittext-inner" id="qText"></div></div>
<div id="qMedia" class="media hidden"></div>
<div id="qTimer" class="timer-bar hidden"><div class="timer-track"><div class="timer-fill" id="timerFill"></div></div><span id="timerText" style="font-family:monospace;font-weight:700;font-size:clamp(1rem,2.5vh,1.6rem);min-width:50px;text-align:right"></span></div>
<button id="revealBtn" class="reveal-btn hidden" onclick="revealAnswer()">Reveal Answer</button>
<div id="answerBox" class="answer-box hidden"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#04a87e;margin-bottom:4px">Answer</div><div class="fittext" id="aFit" style="max-height:15vh"><div class="fittext-inner" id="aText"></div></div></div>
</div></div>
<div class="q-btns"><button class="pill" style="font-size:14px;padding:10px 28px" onclick="goBack()">← Back to Board</button></div>
<div class="hint">Esc = back · Space = reveal · Right-click a cell to un-gray it</div>
</div>
<div id="answerPage" class="qpage hidden">
<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:0;width:100%">
<div class="acard" id="aCard">
<div id="aCat2" style="font-size:clamp(.7rem,1.6vh,.9rem);font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#04a87e;margin-bottom:.3vh;flex-shrink:0"></div>
<div class="fittext" id="aFit2" style="max-height:35vh"><div class="fittext-inner" id="aText2"></div></div>
<div id="aImg2" style="margin-top:1.5vh;flex-shrink:0;max-height:40vh;overflow:hidden"></div>
</div></div>
<div class="q-btns"><button class="pill" style="font-size:14px;padding:10px 28px" onclick="backToQ()">← Back to Question</button></div>
</div>
<script>
const G=${d};
const cats=G.categories,boxes=G.boxes,COLS=G.columns,ROWS=G.rows,TIMER=G.timerSeconds||0;
const THEME=G.theme||{};
let order=boxes.map((_,i)=>i),visited={},curIdx=null,onAnswerPage=false;
const grid=document.getElementById("grid");
grid.style.gridTemplateColumns="repeat("+COLS+",1fr)";
grid.style.gridTemplateRows="repeat("+ROWS+",1fr)";
grid.style.gap=Math.min(.6,3/ROWS)+"vh "+Math.min(.4,2/COLS)+"vw";
const cfv=Math.min(2.8,15/ROWS),sfv=Math.min(2,10/ROWS);
// Apply theme background (supports solid, gradient, image)
(function applyTheme(){
  const bg=document.getElementById("bgLayer");if(!bg)return;
  const t=THEME.bgType||"solid";
  if(t==="image"&&THEME.bgImageUrl){bg.style.background="url("+THEME.bgImageUrl+") center/cover no-repeat"}
  else if(t==="gradient"&&THEME.bgColor){bg.style.background="linear-gradient("+(THEME.bgGradientAngle||135)+"deg, "+THEME.bgColor+", "+(THEME.bgColor2||THEME.bgColor)+")"}
  else if(THEME.bgColor){bg.style.background=THEME.bgColor}
  bg.style.opacity=THEME.bgOpacity!=null?THEME.bgOpacity:1;
})();
function cellBgCss(box){
  if(box.bgOverride){
    if(box.bgOverrideType==="gradient"&&box.bgOverride2){
      return"linear-gradient("+(box.bgOverrideAngle||135)+"deg, "+box.bgOverride+", "+box.bgOverride2+")";
    }
    return box.bgOverride;
  }
  if(THEME.cellType==="gradient"&&THEME.cellBg&&THEME.cellBg2){
    return"linear-gradient("+(THEME.cellGradientAngle||135)+"deg, "+THEME.cellBg+", "+THEME.cellBg2+")";
  }
  return THEME.cellBg||"#fff";
}
let timerInterval=null;
function yid(u){if(!u)return null;const m=u.match(/(?:youtube\\.com\\/(?:watch\\?v=|embed\\/|shorts\\/)|youtu\\.be\\/)([\\w-]{11})/);return m?m[1]:null}
function fitText(outerId,innerId,maxPx,minPx){
  const outer=document.getElementById(outerId),inner=document.getElementById(innerId);
  if(!outer||!inner)return;let lo=minPx||14,hi=maxPx||80,best=lo;
  for(let i=0;i<25;i++){const mid=Math.floor((lo+hi)/2);inner.style.fontSize=mid+"px";
    if(inner.scrollHeight<=outer.clientHeight&&inner.scrollWidth<=outer.clientWidth){best=mid;lo=mid+1}else{hi=mid-1}}
  inner.style.fontSize=best+"px";
}
function buildGrid(){grid.innerHTML="";order.slice(0,COLS*ROWS).forEach(idx=>{
const box=idx<boxes.length?boxes[idx]:null;const d=document.createElement("div");d.className="cell"+(visited[idx]?" v":"");
if(!box){d.style.opacity="0.06";grid.appendChild(d);return}
const cat=cats[box.catIdx]||{name:"?",color:"#999"};
const cellBg=cellBgCss(box);
const borderColor=box.borderOverride||cat.color;
const outerBorder=box.borderOverride||THEME.cellBorder||"#e6e4df";
const cellOpacity=box.cellOpacity!=null?box.cellOpacity:(THEME.cellOpacity!=null?THEME.cellOpacity:1);
if(!visited[idx]){
  d.style.background=cellBg;
  d.style.border="1px solid "+outerBorder;
  d.style.opacity=cellOpacity;
  if(THEME.cellShadow)d.style.boxShadow="0 4px 12px rgba(0,0,0,.2)";
}
d.style.borderLeft="4px solid "+borderColor;
const c=document.createElement("span");c.style.cssText="font-weight:800;font-size:clamp(0.55rem,"+cfv+"vh,1.8rem);line-height:1.1;letter-spacing:-0.3px;color:"+(visited[idx]?"#999":cat.color);c.textContent=cat.name;
const s=document.createElement("span");s.style.cssText="font-weight:500;font-size:clamp(0.4rem,"+sfv+"vh,1.1rem);line-height:1.1;color:"+(visited[idx]?"#bbb":"#78716c");s.textContent=box.subtitle;
d.appendChild(c);d.appendChild(s);
if(!visited[idx])d.addEventListener("click",()=>showQ(idx));
d.addEventListener("contextmenu",e=>{e.preventDefault();if(visited[idx]){delete visited[idx];buildGrid()}});
grid.appendChild(d)})}
function showQ(idx){visited[idx]=true;curIdx=idx;onAnswerPage=false;const box=boxes[idx],cat=cats[box.catIdx]||{name:"?",color:"#999"};
document.getElementById("qCat").textContent=cat.name;document.getElementById("qCat").style.color=cat.color;
document.getElementById("qSub").textContent=box.subtitle;document.getElementById("qText").innerHTML=box.question||"";
document.getElementById("qCard").style.borderTop="5px solid "+cat.color;
const media=document.getElementById("qMedia");media.innerHTML="";media.classList.add("hidden");
if(box.imageUrl){const img=document.createElement("img");img.src=box.imageUrl;img.onerror=()=>img.style.display="none";media.appendChild(img);media.classList.remove("hidden")}
const vid=yid(box.videoUrl);if(vid){const w=document.createElement("div");w.className="yt";w.innerHTML='<iframe src="https://www.youtube.com/embed/'+vid+'" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe>';media.appendChild(w);media.classList.remove("hidden")}
const rb=document.getElementById("revealBtn"),ab=document.getElementById("answerBox");
const hasA=(box.answer&&box.answer.trim())||(box.answerImageUrl&&box.answerImageUrl.trim());
const hasAImg=box.answerImageUrl&&box.answerImageUrl.trim();
if(hasA){rb.classList.remove("hidden");rb.style.background=cat.color+"14";rb.style.color=cat.color;rb.style.border="2px solid "+cat.color+"44";rb.textContent=hasAImg?"Reveal Answer →":"Reveal Answer"}else{rb.classList.add("hidden")}
ab.classList.add("hidden");document.getElementById("aText").innerHTML=box.answer||"";
document.getElementById("gridPage").classList.add("hidden");document.getElementById("qPage").classList.remove("hidden");document.getElementById("answerPage").classList.add("hidden");
const tb=document.getElementById("qTimer");if(TIMER>0){tb.classList.remove("hidden");startTimer(TIMER)}else{tb.classList.add("hidden")}
setTimeout(()=>{fitText("qFit","qText",80,14)},50);
history.pushState({v:"q"},"")}
function revealAnswer(){
const box=boxes[curIdx],cat=cats[box.catIdx]||{name:"?",color:"#999"};
const hasAImg=box.answerImageUrl&&box.answerImageUrl.trim();
if(hasAImg){document.getElementById("aCat2").textContent=cat.name+" — Answer";
document.getElementById("aText2").innerHTML=box.answer||"";
const c=document.getElementById("aImg2");c.innerHTML="";
const img=document.createElement("img");img.src=box.answerImageUrl;img.style.cssText="max-width:100%;max-height:40vh;border-radius:12px;object-fit:contain;border:1px solid #04a87e44";img.onerror=()=>img.style.display="none";c.appendChild(img);
document.getElementById("qPage").classList.add("hidden");document.getElementById("answerPage").classList.remove("hidden");
onAnswerPage=true;setTimeout(()=>{fitText("aFit2","aText2",80,14)},50);history.pushState({v:"a"},"")
}else{document.getElementById("revealBtn").classList.add("hidden");document.getElementById("answerBox").classList.remove("hidden");
setTimeout(()=>{fitText("aFit","aText",60,12)},50)}}
function backToQ(){onAnswerPage=false;document.getElementById("answerPage").classList.add("hidden");document.getElementById("qPage").classList.remove("hidden")}
function goBack(){clearInterval(timerInterval);curIdx=null;onAnswerPage=false;document.getElementById("qPage").classList.add("hidden");document.getElementById("answerPage").classList.add("hidden");document.getElementById("gridPage").classList.remove("hidden");buildGrid()}
function scramble(){for(let i=order.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[order[i],order[j]]=[order[j],order[i]]}buildGrid()}
function resetBoard(){visited={};order=boxes.map((_,i)=>i);buildGrid()}
function toggleFS(){if(!document.fullscreenElement)document.documentElement.requestFullscreen();else document.exitFullscreen()}
function startTimer(s){clearInterval(timerInterval);let left=s;const fill=document.getElementById("timerFill"),txt=document.getElementById("timerText");
function upd(){const p=left/s;fill.style.width=(p*100)+"%";fill.style.background=p>.3?"#1c1917":"#dc2626";txt.style.color=p>.3?"#1c1917":"#dc2626";txt.textContent=Math.floor(left/60)+":"+String(left%60).padStart(2,"0")}
upd();timerInterval=setInterval(()=>{left--;if(left<=0){clearInterval(timerInterval);left=0}upd()},1000)}
window.addEventListener("popstate",()=>{if(onAnswerPage){backToQ()}else if(curIdx!==null){goBack()}});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(onAnswerPage)backToQ();else goBack()}if(e.key===" "&&!document.getElementById("revealBtn").classList.contains("hidden")){e.preventDefault();revealAnswer()}});
buildGrid();
<\/script></body></html>`;
  const blob=new Blob([html],{type:"text/html"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);
  a.download=(game.name||"quiz-board").replace(/[^a-zA-Z0-9-_ ]/g,"").replace(/\s+/g,"-").toLowerCase()+".html";a.click();URL.revokeObjectURL(a.href);
}

/* ═══ JSON IMPORT/EXPORT ═══ */
function exportGameJSON(game){const blob=new Blob([JSON.stringify(game,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=(game.name||"quiz").replace(/[^a-zA-Z0-9-_ ]/g,"").replace(/\s+/g,"-").toLowerCase()+".json";a.click();URL.revokeObjectURL(a.href)}
function importGameJSON(file,cb){const r=new FileReader();r.onload=e=>{try{const g=JSON.parse(e.target.result);if(g.categories&&g.boxes){g.id=uid();cb(g)}else alert("Invalid quiz file")}catch(er){alert("Could not read file: "+er.message)}};r.readAsText(file)}

/* ═══════════════════════════════════════
   HOME
   ═══════════════════════════════════════ */
function Home({games,onCreate,onSelect,onDuplicate,onDelete,onImport,user,onSignOut,publishedIds,onPublish,onUnpublish}){
  const fileRef=useRef(null);
  const[shareId,setShareId]=useState(null);
  const shareUrl=shareId?`${window.location.origin}${window.location.pathname}?game=${shareId}`:"";
  const copyShareLink=()=>{navigator.clipboard.writeText(shareUrl);alert("Link copied to clipboard!")};
  return(<div style={{minHeight:"100vh",background:T.bg,fontFamily:T.font}}>
    <div style={{maxWidth:800,margin:"0 auto",padding:"48px 24px 80px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:40,flexWrap:"wrap",gap:16}}>
        <div><h1 style={{fontSize:36,fontWeight:900,color:T.text,letterSpacing:-1.5,margin:0}}>Quiz Board</h1>
          {user&&<div style={{display:"flex",alignItems:"center",gap:8,marginTop:8}}>
            {user.photoURL&&<img src={user.photoURL} alt="" style={{width:24,height:24,borderRadius:12}} referrerPolicy="no-referrer"/>}
            <span style={{fontSize:13,color:T.textSoft}}>{user.displayName||user.email}</span>
            <button onClick={onSignOut} style={{background:"none",border:"none",fontSize:12,color:T.textMuted,cursor:"pointer",fontFamily:T.font,textDecoration:"underline"}}>Sign out</button>
          </div>}
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><input ref={fileRef} type="file" accept=".json" style={{display:"none"}} onChange={e=>{if(e.target.files[0]){onImport(e.target.files[0]);e.target.value=""}}}/><Btn onClick={()=>fileRef.current?.click()}>Import JSON</Btn><Btn variant="primary" onClick={onCreate} style={{fontSize:15,padding:"12px 28px"}}>+ New Game</Btn></div>
      </div>

      {/* Share link modal */}
      {shareId&&<div onClick={()=>setShareId(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
        <div onClick={e=>e.stopPropagation()} style={{background:T.surface,borderRadius:16,padding:28,maxWidth:500,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,.2)"}}>
          <h3 style={{fontSize:20,fontWeight:800,color:T.text,margin:0,marginBottom:8}}>🌐 Game is published!</h3>
          <p style={{fontSize:13,color:T.textSoft,marginBottom:16}}>Anyone with this link can play your game — no sign in required.</p>
          <div style={{display:"flex",gap:8,marginBottom:16}}>
            <input readOnly value={shareUrl} onClick={e=>e.target.select()} style={{flex:1,padding:"10px 12px",border:`1.5px solid ${T.border}`,borderRadius:8,fontSize:12,outline:"none",fontFamily:T.fontMono,background:T.surfaceAlt,color:T.text}}/>
            <Btn variant="primary" onClick={copyShareLink} style={{fontSize:13,padding:"10px 16px"}}>Copy</Btn>
          </div>
          <p style={{fontSize:12,color:T.textMuted,marginBottom:16}}>Note: Changes you make won't update the public version until you click Publish again.</p>
          <div style={{textAlign:"right"}}><Btn variant="ghost" onClick={()=>setShareId(null)}>Close</Btn></div>
        </div>
      </div>}

      {games.length===0?(<div style={{textAlign:"center",padding:"80px 20px",background:T.surface,borderRadius:T.radius,border:`1.5px dashed ${T.border}`}}><div style={{fontSize:48,marginBottom:12}}>🎯</div><p style={{fontSize:20,fontWeight:700,color:T.text,margin:0}}>No games yet</p><p style={{color:T.textMuted,fontSize:14,marginTop:6}}>Create your first quiz game to get started</p><Btn variant="primary" onClick={onCreate} style={{marginTop:16}}>+ New Game</Btn></div>):(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>{games.map(g=>{
          const isPublished=publishedIds?.has(g.id);
          return(<div key={g.id} style={{background:T.surface,borderRadius:T.radius,border:`1px solid ${T.border}`,overflow:"hidden"}}>
            <div style={{padding:"20px 24px 14px",cursor:"pointer"}} onClick={()=>onSelect(g.id,"edit")}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <div style={{display:"flex",gap:5,flex:1}}>{g.categories.slice(0,8).map((c,ci)=><div key={ci} style={{width:10,height:10,borderRadius:5,background:c.color}}/>)}</div>
                {isPublished&&<span style={{fontSize:10,fontWeight:700,color:T.success,background:T.success+"14",padding:"3px 8px",borderRadius:20,letterSpacing:.5,textTransform:"uppercase"}}>🌐 Public</span>}
              </div>
              <h3 style={{fontSize:18,fontWeight:700,color:T.text,margin:0}}>{g.name}</h3>
              <p style={{fontSize:13,color:T.textMuted,marginTop:4,fontFamily:T.fontMono}}>{g.columns}×{g.rows} · {g.categories.length} cat · {g.boxes.length} Q{g.timerSeconds?` · ${g.timerSeconds}s timer`:""}</p>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:4,padding:"8px 16px 14px",borderTop:`1px solid ${T.borderLight}`,flexWrap:"wrap"}}>
              <Btn variant="primary" onClick={()=>onSelect(g.id,"play")} style={{fontSize:13,padding:"8px 20px"}}>▶ Play</Btn>
              <Btn variant="ghost" onClick={()=>onSelect(g.id,"edit")} style={{fontSize:13}}>✎ Edit</Btn>
              <Btn variant="ghost" onClick={()=>onDuplicate(g.id)} style={{fontSize:13}}>⧉ Dup</Btn>
              {isPublished
                ?<>
                  <Btn variant="ghost" onClick={()=>{onPublish(g);setShareId(g.id)}} style={{fontSize:13,color:T.success}} title="Update public version">↻ Republish</Btn>
                  <Btn variant="ghost" onClick={()=>setShareId(g.id)} style={{fontSize:13}}>🔗 Share</Btn>
                  <Btn variant="ghost" onClick={()=>onUnpublish(g.id)} style={{fontSize:12,color:T.textMuted}}>Unpublish</Btn>
                </>
                :<Btn variant="ghost" onClick={async()=>{const ok=await onPublish(g);if(ok)setShareId(g.id)}} style={{fontSize:13,color:T.success}}>🌐 Publish</Btn>
              }
              <Btn variant="ghost" onClick={()=>exportGameHTML(g)} style={{fontSize:13}}>⤓ HTML</Btn>
              <Btn variant="ghost" onClick={()=>exportGameJSON(g)} style={{fontSize:13}}>⤓ JSON</Btn>
              <div style={{flex:1}}/>
              <Btn variant="danger" onClick={()=>onDelete(g.id)} style={{fontSize:12,padding:"6px 12px"}}>Delete</Btn>
            </div>
          </div>);
        })}</div>)}
    </div>
  </div>);
}

/* ═══════════════════════════════════════
   THEME PANEL
   ═══════════════════════════════════════ */
const GRADIENT_PRESETS=[
  {name:"Sunset",c1:"#ff7e5f",c2:"#feb47b",angle:135},
  {name:"Ocean",c1:"#2193b0",c2:"#6dd5ed",angle:135},
  {name:"Purple",c1:"#8e2de2",c2:"#4a00e0",angle:135},
  {name:"Forest",c1:"#11998e",c2:"#38ef7d",angle:135},
  {name:"Cherry",c1:"#eb3349",c2:"#f45c43",angle:135},
  {name:"Midnight",c1:"#232526",c2:"#414345",angle:135},
  {name:"Gold",c1:"#ffd700",c2:"#ff8c00",angle:135},
  {name:"Rose",c1:"#f093fb",c2:"#f5576c",angle:135},
  {name:"Cool",c1:"#667eea",c2:"#764ba2",angle:135},
  {name:"Warm",c1:"#f857a6",c2:"#ff5858",angle:135},
  {name:"Mint",c1:"#00b09b",c2:"#96c93d",angle:135},
  {name:"Peach",c1:"#ffecd2",c2:"#fcb69f",angle:135},
];

function ThemePanel({theme,updateTheme}){
  const bgType=theme.bgType||"solid";
  const cellType=theme.cellType||"solid";

  const setBgPreset=(p)=>{
    updateTheme("bgType","gradient");
    updateTheme("bgColor",p.c1);
    updateTheme("bgColor2",p.c2);
    updateTheme("bgGradientAngle",p.angle);
  };
  const setCellPreset=(p)=>{
    updateTheme("cellType","gradient");
    updateTheme("cellBg",p.c1);
    updateTheme("cellBg2",p.c2);
    updateTheme("cellGradientAngle",p.angle);
  };

  const lbl={fontSize:11,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1};
  const subLbl={fontSize:11,color:T.textSoft,fontWeight:600,width:56};
  const tabBtn=(active)=>({padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:600,cursor:"pointer",border:"none",background:active?T.text:T.bg,color:active?"#fff":T.textSoft,fontFamily:T.font,transition:"all .1s"});

  return(<div style={{padding:"16px 20px",borderBottom:`1px solid ${T.border}`,background:T.surfaceAlt,flexShrink:0,position:"relative",zIndex:2,maxHeight:"60vh",overflowY:"auto"}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",gap:20}}>

      {/* BACKGROUND */}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <span style={lbl}>Background</span>
          <div style={{display:"flex",gap:4}}>
            <button onClick={()=>updateTheme("bgType","solid")} style={tabBtn(bgType==="solid")}>Solid</button>
            <button onClick={()=>updateTheme("bgType","gradient")} style={tabBtn(bgType==="gradient")}>Gradient</button>
            <button onClick={()=>updateTheme("bgType","image")} style={tabBtn(bgType==="image")}>Image</button>
          </div>
        </div>

        {bgType==="solid"&&<div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={subLbl}>Color</span>
          <input type="color" value={theme.bgColor||"#f4f3f0"} onChange={e=>updateTheme("bgColor",e.target.value)} style={{width:32,height:32,border:`1.5px solid ${T.border}`,borderRadius:8,cursor:"pointer",padding:0}}/>
          <input type="text" value={theme.bgColor||""} onChange={e=>updateTheme("bgColor",e.target.value)} placeholder="(default)" style={{padding:"6px 10px",border:`1.5px solid ${T.border}`,borderRadius:6,fontSize:12,fontFamily:T.fontMono,background:T.surface,width:90}}/>
          {theme.bgColor&&<button onClick={()=>updateTheme("bgColor","")} style={{background:"none",border:"none",fontSize:11,color:T.danger,cursor:"pointer",fontFamily:T.font,fontWeight:600}}>Reset</button>}
        </div>}

        {bgType==="gradient"&&<>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={subLbl}>Colors</span>
            <input type="color" value={theme.bgColor||"#667eea"} onChange={e=>updateTheme("bgColor",e.target.value)} style={{width:32,height:32,border:`1.5px solid ${T.border}`,borderRadius:8,cursor:"pointer",padding:0}}/>
            <span style={{color:T.textMuted}}>→</span>
            <input type="color" value={theme.bgColor2||"#764ba2"} onChange={e=>updateTheme("bgColor2",e.target.value)} style={{width:32,height:32,border:`1.5px solid ${T.border}`,borderRadius:8,cursor:"pointer",padding:0}}/>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={subLbl}>Angle</span>
            <input type="range" min={0} max={360} step={15} value={theme.bgGradientAngle??135} onChange={e=>updateTheme("bgGradientAngle",parseInt(e.target.value))} style={{flex:1}}/>
            <span style={{fontSize:11,fontFamily:T.fontMono,color:T.textMuted,width:40,textAlign:"right"}}>{theme.bgGradientAngle??135}°</span>
          </div>
          <div>
            <span style={{...lbl,fontSize:10}}>Presets</span>
            <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:6,marginTop:6}}>
              {GRADIENT_PRESETS.map(p=><button key={p.name} onClick={()=>setBgPreset(p)} title={p.name}
                style={{height:28,borderRadius:6,border:`1.5px solid ${T.border}`,cursor:"pointer",background:`linear-gradient(${p.angle}deg, ${p.c1}, ${p.c2})`}}/>)}
            </div>
          </div>
        </>}

        {bgType==="image"&&<div style={{display:"flex",alignItems:"flex-start",gap:8}}>
          <span style={{...subLbl,paddingTop:6}}>Image</span>
          <div style={{flex:1}}><ImageUpload value={theme.bgImageUrl||""} onChange={v=>updateTheme("bgImageUrl",v)} label="" color={T.textSoft}/></div>
        </div>}

        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={subLbl}>Opacity</span>
          <input type="range" min={0} max={1} step={0.05} value={theme.bgOpacity??1} onChange={e=>updateTheme("bgOpacity",parseFloat(e.target.value))} style={{flex:1}}/>
          <span style={{fontSize:11,fontFamily:T.fontMono,color:T.textMuted,width:36,textAlign:"right"}}>{Math.round((theme.bgOpacity??1)*100)}%</span>
        </div>

        {/* Preview */}
        <div style={{height:60,borderRadius:10,border:`1.5px solid ${T.border}`,background:bgCss(theme)||T.surface,opacity:theme.bgOpacity??1,position:"relative"}}>
          <span style={{position:"absolute",top:4,right:8,fontSize:10,fontWeight:700,color:T.textMuted,background:"rgba(255,255,255,.7)",padding:"2px 6px",borderRadius:4}}>PREVIEW</span>
        </div>
      </div>

      {/* ALL CELLS */}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <span style={lbl}>All Cells</span>
          <div style={{display:"flex",gap:4}}>
            <button onClick={()=>updateTheme("cellType","solid")} style={tabBtn(cellType==="solid")}>Solid</button>
            <button onClick={()=>updateTheme("cellType","gradient")} style={tabBtn(cellType==="gradient")}>Gradient</button>
          </div>
        </div>

        {cellType==="solid"&&<div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={subLbl}>Fill</span>
          <input type="color" value={theme.cellBg||"#ffffff"} onChange={e=>updateTheme("cellBg",e.target.value)} style={{width:32,height:32,border:`1.5px solid ${T.border}`,borderRadius:8,cursor:"pointer",padding:0}}/>
          <input type="text" value={theme.cellBg||""} onChange={e=>updateTheme("cellBg",e.target.value)} placeholder="(default)" style={{padding:"6px 10px",border:`1.5px solid ${T.border}`,borderRadius:6,fontSize:12,fontFamily:T.fontMono,background:T.surface,width:90}}/>
          {theme.cellBg&&<button onClick={()=>updateTheme("cellBg","")} style={{background:"none",border:"none",fontSize:11,color:T.danger,cursor:"pointer",fontFamily:T.font,fontWeight:600}}>Reset</button>}
        </div>}

        {cellType==="gradient"&&<>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={subLbl}>Colors</span>
            <input type="color" value={theme.cellBg||"#667eea"} onChange={e=>updateTheme("cellBg",e.target.value)} style={{width:32,height:32,border:`1.5px solid ${T.border}`,borderRadius:8,cursor:"pointer",padding:0}}/>
            <span style={{color:T.textMuted}}>→</span>
            <input type="color" value={theme.cellBg2||"#764ba2"} onChange={e=>updateTheme("cellBg2",e.target.value)} style={{width:32,height:32,border:`1.5px solid ${T.border}`,borderRadius:8,cursor:"pointer",padding:0}}/>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={subLbl}>Angle</span>
            <input type="range" min={0} max={360} step={15} value={theme.cellGradientAngle??135} onChange={e=>updateTheme("cellGradientAngle",parseInt(e.target.value))} style={{flex:1}}/>
            <span style={{fontSize:11,fontFamily:T.fontMono,color:T.textMuted,width:40,textAlign:"right"}}>{theme.cellGradientAngle??135}°</span>
          </div>
          <div>
            <span style={{...lbl,fontSize:10}}>Presets</span>
            <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:6,marginTop:6}}>
              {GRADIENT_PRESETS.map(p=><button key={p.name} onClick={()=>setCellPreset(p)} title={p.name}
                style={{height:28,borderRadius:6,border:`1.5px solid ${T.border}`,cursor:"pointer",background:`linear-gradient(${p.angle}deg, ${p.c1}, ${p.c2})`}}/>)}
            </div>
          </div>
        </>}

        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={subLbl}>Border</span>
          <input type="color" value={theme.cellBorder||"#e6e4df"} onChange={e=>updateTheme("cellBorder",e.target.value)} style={{width:32,height:32,border:`1.5px solid ${T.border}`,borderRadius:8,cursor:"pointer",padding:0}}/>
          {theme.cellBorder&&<button onClick={()=>updateTheme("cellBorder","")} style={{background:"none",border:"none",fontSize:11,color:T.danger,cursor:"pointer",fontFamily:T.font,fontWeight:600}}>Reset</button>}
        </div>

        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={subLbl}>Opacity</span>
          <input type="range" min={0.1} max={1} step={0.05} value={theme.cellOpacity??1} onChange={e=>updateTheme("cellOpacity",parseFloat(e.target.value))} style={{flex:1}}/>
          <span style={{fontSize:11,fontFamily:T.fontMono,color:T.textMuted,width:36,textAlign:"right"}}>{Math.round((theme.cellOpacity??1)*100)}%</span>
        </div>

        <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,color:T.text,fontWeight:600}}>
          <input type="checkbox" checked={theme.cellShadow||false} onChange={e=>updateTheme("cellShadow",e.target.checked)} style={{cursor:"pointer",width:16,height:16}}/>
          Drop shadow
        </label>

        {/* Preview */}
        <div style={{height:60,borderRadius:10,border:`1.5px solid ${theme.cellBorder||T.border}`,background:cellBgCss(null,theme,T.surface),opacity:theme.cellOpacity??1,boxShadow:theme.cellShadow?"0 4px 12px rgba(0,0,0,.15)":"none",position:"relative"}}>
          <span style={{position:"absolute",top:4,right:8,fontSize:10,fontWeight:700,color:T.textMuted,background:"rgba(255,255,255,.7)",padding:"2px 6px",borderRadius:4}}>PREVIEW</span>
        </div>

        <p style={{fontSize:11,color:T.textMuted,margin:0}}>Per-cell overrides take priority over these</p>
      </div>
    </div>
  </div>);
}

/* ═══════════════════════════════════════
   EDITOR — Visual grid-based editor
   ═══════════════════════════════════════ */
function Editor({game,onSave,onPlay,onBack}){
  const[name,setName]=useState(game.name);
  const[cats,setCats]=useState(game.categories.map(c=>({...c})));
  // Boxes stored as a flat grid: boxes[row * cols + col]
  const[cols,setCols]=useState(game.columns);
  const[rws,setRws]=useState(game.rows);
  const[timer,setTimer]=useState(game.timerSeconds||0);
  const[theme,setTheme]=useState(game.theme||{bgColor:"",bgImageUrl:"",bgOpacity:1,cellBg:"",cellBorder:""});
  const[saved,setSaved]=useState(false);
  const[editIdx,setEditIdx]=useState(null); // index of cell being edited
  const[showSettings,setShowSettings]=useState(false);
  const[showTheme,setShowTheme]=useState(false);
  const qRef=useRef(null);
  const updateTheme=(f,v)=>setTheme(p=>({...p,[f]:v}));

  // Build grid-sized box array — fill from game.boxes, pad with empties
  const total=cols*rws;
  const initGrid=()=>{
    const g=[];
    for(let i=0;i<total;i++){
      g.push(i<game.boxes.length?{...game.boxes[i]}:{catIdx:0,subtitle:"",question:"",answer:"",imageUrl:"",videoUrl:"",answerImageUrl:""});
    }
    return g;
  };
  const[grid,setGrid]=useState(initGrid);

  // Resize grid when cols/rows change
  useEffect(()=>{
    setGrid(prev=>{
      const newTotal=cols*rws;
      const g=[];
      for(let i=0;i<newTotal;i++){
        g.push(i<prev.length?{...prev[i]}:{catIdx:0,subtitle:"",question:"",answer:"",imageUrl:"",videoUrl:"",answerImageUrl:""});
      }
      return g;
    });
    if(editIdx!==null&&editIdx>=cols*rws)setEditIdx(null);
  },[cols,rws]);

  const updateCat=(i,f,v)=>setCats(p=>p.map((c,j)=>j===i?{...c,[f]:v}:c));
  const addCat=()=>setCats(p=>[...p,{name:"New Category",color:PC[p.length%PC.length]}]);
  const removeCat=idx=>{
    if(cats.length<=1)return;
    setCats(p=>p.filter((_,i)=>i!==idx));
    setGrid(p=>p.map(b=>b.catIdx===idx?{...b,catIdx:0}:b.catIdx>idx?{...b,catIdx:b.catIdx-1}:b));
  };
  const updateCell=(i,f,v)=>setGrid(p=>p.map((b,j)=>j===i?{...b,[f]:v}:b));
  const clearCell=i=>setGrid(p=>p.map((b,j)=>j===i?{catIdx:p[j].catIdx,subtitle:"",question:"",answer:"",imageUrl:"",videoUrl:"",answerImageUrl:""}:b));
  const swapCells=(a,b)=>setGrid(p=>{const n=[...p];[n[a],n[b]]=[n[b],n[a]];return n});

  const getData=()=>({...game,name,categories:cats,boxes:grid.slice(0,cols*rws),columns:cols,rows:rws,timerSeconds:timer,theme});
  const handleSave=()=>{onSave(getData());setSaved(true);setTimeout(()=>setSaved(false),1500)};
  const handlePlay=()=>{onSave(getData());onPlay(getData())};

  const editBox=editIdx!==null?grid[editIdx]:null;
  const editCat=editBox?cats[editBox.catIdx]||cats[0]:null;

  const inp={padding:"8px 12px",border:`1.5px solid ${T.borderLight}`,borderRadius:8,fontSize:13,outline:"none",fontFamily:T.font,color:T.text,background:T.surfaceAlt};

  // Drag state
  const[dragIdx,setDragIdx]=useState(null);

  const cellFilled=b=>b&&(b.question||b.subtitle||b.answer||b.imageUrl||b.videoUrl||b.answerImageUrl);

  return(<div style={{minHeight:"100vh",background:T.bg,fontFamily:T.font,display:"flex",flexDirection:"column",position:"relative"}}>
    {/* Background image/color — sits behind ALL editor UI */}
    {(()=>{const bg=bgCss(theme);return bg?<div style={{position:"fixed",inset:0,background:bg,opacity:theme.bgOpacity??1,pointerEvents:"none",zIndex:0}}/>:null})()}
    {/* ─── Top bar ─── */}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 20px",borderBottom:`1px solid ${T.border}`,background:T.surface,flexShrink:0,gap:8,flexWrap:"wrap",position:"relative",zIndex:2}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <Btn variant="ghost" onClick={()=>{handleSave();onBack()}} style={{fontSize:13}}>← Back</Btn>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="Game name" style={{border:"none",outline:"none",fontSize:20,fontWeight:800,color:T.text,background:"transparent",fontFamily:T.font,width:200,letterSpacing:-.3}}/>
      </div>
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        {saved&&<span style={{fontSize:12,color:T.success,fontWeight:600}}>Saved ✓</span>}
        <Btn variant="ghost" onClick={()=>{setShowSettings(!showSettings);if(showTheme)setShowTheme(false)}} style={{fontSize:12}}>⚙ Settings</Btn>
        <Btn variant="ghost" onClick={()=>{setShowTheme(!showTheme);if(showSettings)setShowSettings(false)}} style={{fontSize:12}}>🎨 Theme</Btn>
        <Btn onClick={handleSave} style={{fontSize:13,padding:"8px 18px"}}>Save</Btn>
        <Btn variant="primary" onClick={handlePlay} style={{fontSize:13,padding:"8px 18px"}}>▶ Play</Btn>
      </div>
    </div>

    {/* ─── Settings panel (collapsible) ─── */}
    {showSettings&&<div style={{padding:"16px 20px",borderBottom:`1px solid ${T.border}`,background:T.surfaceAlt,display:"flex",gap:24,alignItems:"flex-start",flexWrap:"wrap",flexShrink:0,position:"relative",zIndex:2}}>
      {/* Grid */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        <span style={{fontSize:11,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1}}>Grid</span>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          {[["Cols",cols,setCols],["Rows",rws,setRws]].map(([l,v,s])=><div key={l} style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:11,fontWeight:600,color:T.textMuted}}>{l}</span>
            <input type="number" min={1} max={10} value={v} onChange={e=>s(Math.max(1,Math.min(10,+e.target.value||1)))} style={{width:48,padding:"6px 8px",border:`1.5px solid ${T.border}`,borderRadius:8,fontSize:14,fontWeight:700,textAlign:"center",outline:"none",fontFamily:T.fontMono,background:T.surface}}/>
          </div>)}
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:11,fontWeight:600,color:T.textMuted}}>Timer</span>
            <input type="number" min={0} max={600} value={timer} onChange={e=>setTimer(Math.max(0,Math.min(600,+e.target.value||0)))} style={{width:60,padding:"6px 8px",border:`1.5px solid ${T.border}`,borderRadius:8,fontSize:14,fontWeight:700,textAlign:"center",outline:"none",fontFamily:T.fontMono,background:T.surface}}/>
            <span style={{fontSize:11,color:T.textMuted}}>sec</span>
          </div>
        </div>
      </div>
      {/* Play options (per-game) */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        <span style={{fontSize:11,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1}}>Play Options</span>
        <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
          <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,color:T.text,fontWeight:600}}>
            <input type="checkbox" checked={theme.autoFit||false} onChange={e=>updateTheme("autoFit",e.target.checked)} style={{cursor:"pointer",width:16,height:16}}/>
            Auto-fit text
          </label>
          <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,color:T.text,fontWeight:600}}>
            <input type="checkbox" checked={theme.showScoreboard||false} onChange={e=>updateTheme("showScoreboard",e.target.checked)} style={{cursor:"pointer",width:16,height:16}}/>
            Scoreboard
          </label>
        </div>
        {theme.showScoreboard&&<div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={{fontSize:11,color:T.textSoft}}>Points:</span>
          {[5,10,25,50,100,200,500].map(v=><button key={v} onClick={()=>updateTheme("pointStep",v)} style={{padding:"3px 8px",borderRadius:6,fontSize:11,fontWeight:700,fontFamily:T.fontMono,cursor:"pointer",border:"none",background:(theme.pointStep||100)===v?T.text:T.bg,color:(theme.pointStep||100)===v?"#fff":T.textSoft}}>{v}</button>)}
        </div>}
      </div>
    </div>}

    {/* ─── Theme panel (collapsible) ─── */}
    {showTheme&&<ThemePanel theme={theme} updateTheme={updateTheme}/>}

    {/* ─── Category bar ─── */}
    <div style={{padding:"10px 20px",borderBottom:`1px solid ${T.border}`,background:T.surface,display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",flexShrink:0,position:"relative",zIndex:2}}>
      <span style={{fontSize:11,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1,marginRight:4}}>Categories</span>
      {cats.map((cat,ci)=><div key={ci} style={{display:"flex",alignItems:"center",gap:4,background:T.bg,borderRadius:20,padding:"4px 6px 4px 4px",border:`1.5px solid ${T.border}`}}>
        <input type="color" value={cat.color} onChange={e=>updateCat(ci,"color",e.target.value)} style={{width:20,height:20,border:"none",borderRadius:10,cursor:"pointer",padding:0,flexShrink:0}}/>
        <input value={cat.name} onChange={e=>updateCat(ci,"name",e.target.value)} style={{border:"none",outline:"none",fontSize:13,fontWeight:600,color:T.text,background:"transparent",width:Math.max(60,cat.name.length*8),fontFamily:T.font}}/>
        {cats.length>1&&<button onClick={()=>removeCat(ci)} style={{background:"none",border:"none",fontSize:14,color:T.textMuted,cursor:"pointer",lineHeight:1,padding:"0 2px"}}>×</button>}
      </div>)}
      <button onClick={addCat} style={{background:"none",border:`1.5px dashed ${T.border}`,borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:600,color:T.textMuted,cursor:"pointer",fontFamily:T.font}}>+</button>
    </div>

    <div style={{display:"flex",flex:1,minHeight:0,overflow:"hidden",position:"relative",zIndex:1}}>
      {/* ─── GRID ─── */}
      <div style={{flex:1,padding:16,overflow:"auto",position:"relative"}}>
        <div style={{display:"grid",gridTemplateColumns:`repeat(${cols},1fr)`,gap:8,maxWidth:900,margin:"0 auto"}}>
          {grid.slice(0,cols*rws).map((box,i)=>{
            const cat=cats[box.catIdx]||cats[0]||{name:"?",color:"#999"};
            const filled=cellFilled(box);
            const isEditing=editIdx===i;
            const cellBg=cellBgCss(box,theme,T.surface);
            const borderColor=box.borderOverride||cat.color;
            const outerBorder=box.borderOverride||theme.cellBorder||T.border;
            const cellOpacity=box.cellOpacity!=null?box.cellOpacity:(theme.cellOpacity??1);
            const hasGrad=(box.bgOverrideType==="gradient"||(!box.bgOverride&&theme.cellType==="gradient"));
            return(<div key={i}
              draggable
              onDragStart={()=>setDragIdx(i)}
              onDragOver={e=>e.preventDefault()}
              onDrop={()=>{if(dragIdx!==null&&dragIdx!==i){swapCells(dragIdx,i);if(editIdx===dragIdx)setEditIdx(i);else if(editIdx===i)setEditIdx(dragIdx)}setDragIdx(null)}}
              onClick={()=>setEditIdx(i)}
              style={{
                background:isEditing?cat.color+"22":cellBg,
                border:isEditing?`2px solid ${cat.color}`:`1.5px solid ${filled?outerBorder:T.borderLight}`,
                borderLeft:`4px solid ${borderColor}`,
                borderRadius:12,padding:"12px 10px",cursor:"pointer",
                minHeight:80,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                gap:4,transition:"all .15s",position:"relative",
                opacity:filled?cellOpacity:(cellOpacity*0.55),
                boxShadow:theme.cellShadow?"0 4px 12px rgba(0,0,0,.15)":"none",
              }}>
              <span style={{fontWeight:800,fontSize:13,color:cat.color,lineHeight:1.1,textAlign:"center",textShadow:hasGrad?"0 1px 2px rgba(255,255,255,.5)":"none"}}>{cat.name}</span>
              <span style={{fontWeight:500,fontSize:11,color:T.textSoft,lineHeight:1.1,textAlign:"center"}}>{box.subtitle||"—"}</span>
              {filled&&<div style={{position:"absolute",top:6,right:6,width:7,height:7,borderRadius:4,background:T.success}}/>}
              {(box.imageUrl||box.answerImageUrl)&&<div style={{position:"absolute",bottom:6,right:6,fontSize:10,color:T.textMuted}}>🖼</div>}
              {(box.bgOverride||box.borderOverride||box.cellOpacity!=null)&&<div style={{position:"absolute",top:6,left:10,fontSize:9,color:T.textMuted}}>🎨</div>}
            </div>);
          })}
        </div>
        <p style={{textAlign:"center",color:T.textMuted,fontSize:12,marginTop:12}}>Click a cell to edit · Drag cells to rearrange</p>
      </div>

      {/* ─── DETAIL PANEL (right side) ─── */}
      {editIdx!==null&&editBox&&<div style={{width:380,borderLeft:`1px solid ${T.border}`,background:T.surface,overflowY:"auto",flexShrink:0,padding:20,display:"flex",flexDirection:"column",gap:10}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontSize:14,fontWeight:800,color:editCat?.color||T.text}}>Cell {editIdx+1}</span>
          <div style={{display:"flex",gap:4}}>
            <button onClick={()=>clearCell(editIdx)} style={{background:"none",border:"none",fontSize:12,color:T.danger,cursor:"pointer",fontFamily:T.font,fontWeight:600}}>Clear</button>
            <button onClick={()=>setEditIdx(null)} style={{background:"none",border:"none",fontSize:18,color:T.textMuted,cursor:"pointer",lineHeight:1}}>×</button>
          </div>
        </div>

        {/* Category selector */}
        <div>
          <span style={{fontSize:11,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1}}>Category</span>
          <div style={{display:"flex",gap:4,marginTop:4,flexWrap:"wrap"}}>
            {cats.map((c,ci)=><button key={ci} onClick={()=>updateCell(editIdx,"catIdx",ci)}
              style={{padding:"5px 10px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",
                border:editBox.catIdx===ci?`2px solid ${c.color}`:`1.5px solid ${T.border}`,
                background:editBox.catIdx===ci?c.color+"18":"transparent",
                color:editBox.catIdx===ci?c.color:T.textSoft,fontFamily:T.font,
              }}>{c.name}</button>)}
          </div>
        </div>

        {/* Subtitle */}
        <div>
          <span style={{fontSize:11,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1}}>Subtitle</span>
          <input value={editBox.subtitle} onChange={e=>updateCell(editIdx,"subtitle",e.target.value)} placeholder="e.g. Easy, Round 1, Topic…" style={{...inp,width:"100%",marginTop:4}}/>
        </div>

        {/* Question */}
        <div>
          <span style={{fontSize:11,fontWeight:700,color:T.textSoft,textTransform:"uppercase",letterSpacing:1}}>Question</span>
          <FormatBar targetRef={qRef}/>
          <RichInput ref={qRef} value={editBox.question} onChange={v=>updateCell(editIdx,"question",v)} placeholder="Type your question here…" style={{minHeight:80}}/>
        </div>

        {/* Answer */}
        <div>
          <span style={{fontSize:11,fontWeight:700,color:T.success,textTransform:"uppercase",letterSpacing:1}}>Answer</span>
          <RichInput value={editBox.answer||""} onChange={v=>updateCell(editIdx,"answer",v)} placeholder="Answer (revealed on click)" style={{minHeight:50,borderColor:T.success+"44",background:"#f0faf6"}}/>
        </div>

        {/* Media */}
        <ImageUpload value={editBox.imageUrl||""} onChange={v=>updateCell(editIdx,"imageUrl",v)} label="🖼 Question Image" color="#1a8faa"/>

        <div>
          <span style={{fontSize:10,fontWeight:700,color:"#c43040",textTransform:"uppercase",letterSpacing:1}}>▶ YouTube URL</span>
          <input value={editBox.videoUrl||""} onChange={e=>updateCell(editIdx,"videoUrl",e.target.value)} placeholder="https://youtube.com/..." style={{...inp,width:"100%",marginTop:2}}/>
          {editBox.videoUrl&&<div style={{marginTop:6}}><MediaPreview videoUrl={editBox.videoUrl} maxHeight="100px"/></div>}
        </div>

        <ImageUpload value={editBox.answerImageUrl||""} onChange={v=>updateCell(editIdx,"answerImageUrl",v)} label="🖼 Answer Image" color={T.success} borderColor={T.success+"44"}/>

        {/* Per-cell color overrides */}
        <div style={{marginTop:6,paddingTop:10,borderTop:`1px solid ${T.borderLight}`}}>
          <span style={{fontSize:11,fontWeight:700,color:T.textMuted,textTransform:"uppercase",letterSpacing:1}}>Cell Colors (override)</span>

          {/* Type selector */}
          <div style={{display:"flex",gap:4,marginTop:6}}>
            <button onClick={()=>updateCell(editIdx,"bgOverrideType","solid")} style={{padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",border:"none",background:(editBox.bgOverrideType||"solid")==="solid"?T.text:T.bg,color:(editBox.bgOverrideType||"solid")==="solid"?"#fff":T.textSoft,fontFamily:T.font}}>Solid</button>
            <button onClick={()=>updateCell(editIdx,"bgOverrideType","gradient")} style={{padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",border:"none",background:editBox.bgOverrideType==="gradient"?T.text:T.bg,color:editBox.bgOverrideType==="gradient"?"#fff":T.textSoft,fontFamily:T.font}}>Gradient</button>
          </div>

          {(editBox.bgOverrideType||"solid")==="solid"?
            <div style={{display:"flex",alignItems:"center",gap:8,marginTop:6}}>
              <span style={{fontSize:12,color:T.textSoft,width:52}}>Fill</span>
              <input type="color" value={editBox.bgOverride||"#ffffff"} onChange={e=>updateCell(editIdx,"bgOverride",e.target.value)} style={{width:28,height:28,border:`1.5px solid ${T.border}`,borderRadius:6,cursor:"pointer",padding:0}}/>
              {editBox.bgOverride&&<button onClick={()=>updateCell(editIdx,"bgOverride","")} style={{background:"none",border:"none",fontSize:11,color:T.danger,cursor:"pointer",fontFamily:T.font}}>Reset</button>}
            </div>
            :<>
              <div style={{display:"flex",alignItems:"center",gap:6,marginTop:6}}>
                <span style={{fontSize:12,color:T.textSoft,width:52}}>Colors</span>
                <input type="color" value={editBox.bgOverride||"#667eea"} onChange={e=>updateCell(editIdx,"bgOverride",e.target.value)} style={{width:28,height:28,border:`1.5px solid ${T.border}`,borderRadius:6,cursor:"pointer",padding:0}}/>
                <span style={{color:T.textMuted}}>→</span>
                <input type="color" value={editBox.bgOverride2||"#764ba2"} onChange={e=>updateCell(editIdx,"bgOverride2",e.target.value)} style={{width:28,height:28,border:`1.5px solid ${T.border}`,borderRadius:6,cursor:"pointer",padding:0}}/>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}>
                <span style={{fontSize:12,color:T.textSoft,width:52}}>Angle</span>
                <input type="range" min={0} max={360} step={15} value={editBox.bgOverrideAngle??135} onChange={e=>updateCell(editIdx,"bgOverrideAngle",parseInt(e.target.value))} style={{flex:1}}/>
                <span style={{fontSize:10,fontFamily:T.fontMono,color:T.textMuted,width:32,textAlign:"right"}}>{editBox.bgOverrideAngle??135}°</span>
              </div>
            </>
          }
          <div style={{display:"flex",alignItems:"center",gap:8,marginTop:4}}>
            <span style={{fontSize:12,color:T.textSoft,width:52}}>Border</span>
            <input type="color" value={editBox.borderOverride||editCat?.color||"#999"} onChange={e=>updateCell(editIdx,"borderOverride",e.target.value)} style={{width:28,height:28,border:`1.5px solid ${T.border}`,borderRadius:6,cursor:"pointer",padding:0}}/>
            {editBox.borderOverride&&<button onClick={()=>updateCell(editIdx,"borderOverride","")} style={{background:"none",border:"none",fontSize:11,color:T.danger,cursor:"pointer",fontFamily:T.font}}>Reset</button>}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8,marginTop:4}}>
            <span style={{fontSize:12,color:T.textSoft,width:52}}>Opacity</span>
            <input type="range" min={0.1} max={1} step={0.05} value={editBox.cellOpacity??theme.cellOpacity??1} onChange={e=>updateCell(editIdx,"cellOpacity",parseFloat(e.target.value))} style={{flex:1}}/>
            <span style={{fontSize:10,fontFamily:T.fontMono,color:T.textMuted,width:32,textAlign:"right"}}>{Math.round((editBox.cellOpacity??theme.cellOpacity??1)*100)}%</span>
            {editBox.cellOpacity!=null&&<button onClick={()=>updateCell(editIdx,"cellOpacity",null)} style={{background:"none",border:"none",fontSize:11,color:T.danger,cursor:"pointer",fontFamily:T.font}}>Reset</button>}
          </div>
        </div>

        {/* Navigation */}
        <div style={{display:"flex",gap:6,marginTop:8,borderTop:`1px solid ${T.borderLight}`,paddingTop:12}}>
          <Btn variant="ghost" onClick={()=>setEditIdx(Math.max(0,editIdx-1))} disabled={editIdx<=0} style={{fontSize:12,flex:1,justifyContent:"center",opacity:editIdx<=0?.3:1}}>← Prev</Btn>
          <Btn variant="ghost" onClick={()=>setEditIdx(Math.min(cols*rws-1,editIdx+1))} disabled={editIdx>=cols*rws-1} style={{fontSize:12,flex:1,justifyContent:"center",opacity:editIdx>=cols*rws-1?.3:1}}>Next →</Btn>
        </div>
      </div>}
    </div>
  </div>);
}

/* ═══════════════════════════════════════
   PLAY MODE
   ═══════════════════════════════════════ */
function PlayBoard({game,onEdit,onHome,guestMode}){
  const{categories,boxes,columns,rows,timerSeconds}=game;
  const theme=game.theme||{};
  const autoFit=theme.autoFit||false;
  const showSB=theme.showScoreboard||false;
  const pointStep=theme.pointStep||100;
  const[order,setOrder]=useState(()=>boxes.map((_,i)=>i));
  const[visited,setVisited]=useState({});
  const[activeIdx,setActiveIdx]=useState(null);
  const[showAnswer,setShowAnswer]=useState(false);
  const[scores,setScores]=useState([]);

  const cfv=Math.min(2.8,15/rows),sfv=Math.min(2,10/rows);
  const total=columns*rows;
  const strike={textDecoration:"line-through",textDecorationColor:"#c43040",textDecorationThickness:"2.5px"};

  const unvisit=i=>{setVisited(p=>{const n={...p};delete n[i];return n})};
  const reset=()=>{setVisited({});setActiveIdx(null);setShowAnswer(false);setOrder(boxes.map((_,i)=>i))};
  const doScramble=useCallback(()=>setOrder(p=>shuffle(p)),[]);
  const toggleFS=()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen();else document.exitFullscreen()};

  // Push browser history entries so back-swipe navigates within the app, not away
  useEffect(()=>{
    const onPop=()=>{
      if(activeIdx!==null){
        if(showAnswer){setShowAnswer(false)}
        else{setActiveIdx(null);setShowAnswer(false)}
      }
    };
    window.addEventListener("popstate",onPop);
    return()=>window.removeEventListener("popstate",onPop);
  },[activeIdx,showAnswer]);

  const openQuestion=i=>{
    setVisited(p=>({...p,[i]:true}));setActiveIdx(i);setShowAnswer(false);
    window.history.pushState({view:"question"},"");
  };
  const revealAns=()=>{
    setShowAnswer(true);
    window.history.pushState({view:"answer"},"");
  };
  const goBack=()=>{
    if(showAnswer){setShowAnswer(false)}
    else{setActiveIdx(null);setShowAnswer(false)}
  };

  useEffect(()=>{
    const h=e=>{
      if(e.key==="Escape"){e.preventDefault();goBack()}
      if(e.key===" "&&activeIdx!==null&&!showAnswer){e.preventDefault();revealAns()}
    };
    window.addEventListener("keydown",h);return()=>window.removeEventListener("keydown",h);
  },[activeIdx,showAnswer]);

  // ─── ANSWER PAGE (separate full page when answer has image) ───
  if(activeIdx!==null&&activeIdx<boxes.length&&showAnswer){
    const box=boxes[activeIdx];const cat=categories[box.catIdx]||{name:"?",color:"#999"};
    const hasImg=box.answerImageUrl&&box.answerImageUrl.trim();

    if(autoFit){
      return(
        <div style={{position:"fixed",inset:0,display:"flex",flexDirection:"column",padding:"1.5vh 1.5vw",background:T.bg,fontFamily:T.font,overflow:"hidden"}}>
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:0}}>
            <div style={{background:"#f0faf6",border:`1.5px solid ${T.success}33`,borderRadius:20,padding:"2.5vh 2.5vw",maxWidth:1200,width:"100%",textAlign:"center",display:"flex",flexDirection:"column",alignItems:"center",overflow:"hidden",maxHeight:"84vh"}}>
              <div style={{fontSize:"clamp(.7rem,1.6vh,.9rem)",fontWeight:700,textTransform:"uppercase",letterSpacing:2,color:T.success,marginBottom:".3vh",flexShrink:0}}>{cat.name} — Answer</div>
              {box.answer&&box.answer.trim()&&<AutoFitText html={box.answer} baseSizePx={80} minSizePx={14} style={{flex:"0 1 auto",maxHeight:hasImg?"30vh":"50vh"}}/>}
              {hasImg&&<img src={box.answerImageUrl} alt="" style={{maxWidth:"100%",flex:"0 1 auto",maxHeight:"40vh",borderRadius:12,objectFit:"contain",marginTop:"1.5vh",border:`1px solid ${T.success}44`}} onError={e=>{e.target.style.display="none"}}/>}
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"center",gap:12,flexShrink:0,paddingTop:"0.8vh"}}><Btn onClick={goBack} style={{fontSize:14,padding:"10px 28px"}}>← Back to Question</Btn></div>
        </div>);
    }

    // Normal scrollable answer page
    return(
      <div style={{position:"fixed",inset:0,display:"flex",flexDirection:"column",alignItems:"center",padding:"2vh 2vw",background:T.bg,fontFamily:T.font,overflowY:"auto"}}>
        <div style={{background:"#f0faf6",border:`1.5px solid ${T.success}33`,borderRadius:24,padding:"4vh 3vw",maxWidth:1100,width:"100%",textAlign:"center",boxShadow:"0 12px 60px rgba(0,0,0,.06)",marginTop:"auto",marginBottom:"2vh"}}>
          <div style={{fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:3,color:T.success,marginBottom:"1vh"}}>{cat.name} — Answer</div>
          {box.answer&&box.answer.trim()&&<div style={{fontSize:"clamp(1.4rem,5vh,3.2rem)",lineHeight:1.3,color:T.text,fontWeight:700,fontFamily:T.font}} dangerouslySetInnerHTML={{__html:box.answer}}/>}
          {hasImg&&<div style={{marginTop:"2vh"}}><img src={box.answerImageUrl} alt="" style={{maxWidth:"100%",maxHeight:"50vh",borderRadius:12,objectFit:"contain",border:`1px solid ${T.success}44`}} onError={e=>{e.target.style.display="none"}}/></div>}
        </div>
        <div style={{display:"flex",gap:12,marginBottom:"auto",flexShrink:0}}><Btn onClick={goBack} style={{fontSize:15,padding:"12px 32px"}}>← Back to Question</Btn></div>
      </div>);
  }

  // ─── QUESTION PAGE ───
  if(activeIdx!==null&&activeIdx<boxes.length){
    const box=boxes[activeIdx];const cat=categories[box.catIdx]||{name:"?",color:"#999"};
    const hasAnswer=(box.answer&&box.answer.trim())||(box.answerImageUrl&&box.answerImageUrl.trim());
    const hasAnswerImg=box.answerImageUrl&&box.answerImageUrl.trim();
    // If answer has image → reveal goes to separate page. If no image → inline reveal.

    if(autoFit){
      return(
        <div style={{position:"fixed",inset:0,display:"flex",flexDirection:"column",padding:"1.5vh 1.5vw",background:T.bg,fontFamily:T.font,overflow:"hidden"}}>
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:0}}>
            <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:20,padding:"2vh 2.5vw",maxWidth:1200,width:"100%",textAlign:"center",boxShadow:"0 12px 60px rgba(0,0,0,.06)",borderTop:`5px solid ${cat.color}`,display:"flex",flexDirection:"column",alignItems:"center",overflow:"hidden",maxHeight:"82vh"}}>
              <div style={{fontWeight:800,fontSize:"clamp(.8rem,2.2vh,1.3rem)",textTransform:"uppercase",letterSpacing:3,marginBottom:".3vh",color:cat.color,fontFamily:T.font,flexShrink:0}}>{cat.name}</div>
              <div style={{fontWeight:500,fontSize:"clamp(.7rem,1.8vh,1rem)",color:T.textSoft,marginBottom:"1.5vh",flexShrink:0}}>{box.subtitle}</div>
              <AutoFitText html={box.question} baseSizePx={80} minSizePx={14} style={{flex:"0 1 auto",maxHeight:"40vh"}}/>
              {(box.imageUrl||ytId(box.videoUrl))&&<div style={{flexShrink:0,maxHeight:"20vh",overflow:"hidden",marginTop:"1.5vh",width:"100%",display:"flex",justifyContent:"center"}}>
                {box.imageUrl&&<img src={box.imageUrl} alt="" style={{maxWidth:"100%",maxHeight:"20vh",borderRadius:10,objectFit:"contain"}} onError={e=>{e.target.style.display="none"}}/>}
                {ytId(box.videoUrl)&&<div style={{width:"100%",maxWidth:400,aspectRatio:"16/9",borderRadius:10,overflow:"hidden"}}><iframe src={`https://www.youtube.com/embed/${ytId(box.videoUrl)}`} title="Video" style={{width:"100%",height:"100%",border:"none"}} allowFullScreen/></div>}
              </div>}
              {(timerSeconds||0)>0&&<div style={{flexShrink:0,width:"100%"}}><Timer seconds={timerSeconds}/></div>}
              {hasAnswer&&!hasAnswerImg&&!showAnswer&&<button onClick={revealAns} style={{marginTop:"1.5vh",padding:"10px 28px",fontSize:"clamp(.8rem,1.8vh,1.1rem)",fontWeight:700,fontFamily:T.font,cursor:"pointer",background:cat.color+"14",color:cat.color,border:`2px solid ${cat.color}44`,borderRadius:50,flexShrink:0}}>Reveal Answer</button>}
              {hasAnswer&&hasAnswerImg&&<button onClick={revealAns} style={{marginTop:"1.5vh",padding:"10px 28px",fontSize:"clamp(.8rem,1.8vh,1.1rem)",fontWeight:700,fontFamily:T.font,cursor:"pointer",background:cat.color+"14",color:cat.color,border:`2px solid ${cat.color}44`,borderRadius:50,flexShrink:0}}>Reveal Answer →</button>}
              {hasAnswer&&!hasAnswerImg&&showAnswer&&<div style={{marginTop:"1.5vh",padding:"1.5vh 2vw",background:"#f0faf6",borderRadius:12,border:`1.5px solid ${T.success}33`,width:"100%",flexShrink:0}}>
                <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:2,color:T.success,marginBottom:4}}>Answer</div>
                <AutoFitText html={box.answer} baseSizePx={60} minSizePx={12} style={{maxHeight:"15vh"}}/>
              </div>}
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"center",gap:12,flexShrink:0,paddingTop:"0.8vh"}}><Btn onClick={goBack} style={{fontSize:14,padding:"10px 28px"}}>← Back</Btn></div>
        </div>);
    }

    // Normal mode: scrollable
    return(
      <div style={{position:"fixed",inset:0,display:"flex",flexDirection:"column",alignItems:"center",padding:"2vh 2vw",background:T.bg,fontFamily:T.font,overflowY:"auto"}}>
        <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:24,padding:"4vh 3vw",maxWidth:1100,width:"100%",textAlign:"center",boxShadow:"0 12px 60px rgba(0,0,0,.06)",borderTop:`6px solid ${cat.color}`,marginTop:"auto",marginBottom:"2vh"}}>
          <div style={{fontWeight:800,fontSize:"clamp(1rem,2.8vh,1.6rem)",textTransform:"uppercase",letterSpacing:4,marginBottom:".5vh",color:cat.color,fontFamily:T.font}}>{cat.name}</div>
          <div style={{fontWeight:500,fontSize:"clamp(.9rem,2.2vh,1.3rem)",color:T.textSoft,marginBottom:"3vh"}}>{box.subtitle}</div>
          <div style={{fontSize:"clamp(1.4rem,5vh,3.2rem)",lineHeight:1.3,color:T.text,fontWeight:700,letterSpacing:-.5,fontFamily:T.font}} dangerouslySetInnerHTML={{__html:box.question}}/>
          <MediaPreview imageUrl={box.imageUrl} videoUrl={box.videoUrl} maxHeight="35vh"/>
          {(timerSeconds||0)>0&&<Timer seconds={timerSeconds}/>}
          {hasAnswer&&!hasAnswerImg&&!showAnswer&&<button onClick={revealAns} style={{marginTop:"3vh",padding:"14px 36px",fontSize:"clamp(.9rem,2vh,1.2rem)",fontWeight:700,fontFamily:T.font,cursor:"pointer",background:cat.color+"14",color:cat.color,border:`2px solid ${cat.color}44`,borderRadius:50,transition:"all .15s"}}>Reveal Answer</button>}
          {hasAnswer&&hasAnswerImg&&<button onClick={revealAns} style={{marginTop:"3vh",padding:"14px 36px",fontSize:"clamp(.9rem,2vh,1.2rem)",fontWeight:700,fontFamily:T.font,cursor:"pointer",background:cat.color+"14",color:cat.color,border:`2px solid ${cat.color}44`,borderRadius:50,transition:"all .15s"}}>Reveal Answer →</button>}
          {hasAnswer&&!hasAnswerImg&&showAnswer&&<div style={{marginTop:"3vh",padding:"3vh 3vw",background:"#f0faf6",borderRadius:16,border:`1.5px solid ${T.success}33`}}>
            <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:2,color:T.success,marginBottom:8}}>Answer</div>
            <div style={{fontSize:"clamp(1.2rem,4vh,2.6rem)",lineHeight:1.3,color:T.text,fontWeight:700,fontFamily:T.font}} dangerouslySetInnerHTML={{__html:box.answer}}/>
          </div>}
        </div>
        <div style={{display:"flex",gap:12,marginBottom:"auto",flexShrink:0}}><Btn onClick={goBack} style={{fontSize:15,padding:"12px 32px"}}>← Back to Board</Btn></div>
        <p style={{color:T.textMuted,fontSize:12,marginTop:8,flexShrink:0}}>Esc = back · Space = reveal · Right-click cells to un-gray</p>
      </div>);
  }

  // Grid view
  return(
    <div style={{position:"fixed",inset:0,display:"flex",flexDirection:"column",padding:"1vh 1.5vw",background:T.bg,fontFamily:T.font,overflow:"hidden"}}>
      {/* Background layer */}
      {(()=>{const bg=bgCss(theme);return bg?<div style={{position:"absolute",inset:0,background:bg,opacity:theme.bgOpacity??1,pointerEvents:"none",zIndex:0}}/>:null})()}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,flexWrap:"nowrap",gap:6,marginBottom:"0.6vh",position:"relative",zIndex:1}}>
        <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}><Btn variant="ghost" onClick={onHome} style={{fontSize:12,padding:"5px 8px"}}>{guestMode?"✕ Exit":"← Home"}</Btn><h1 style={{fontSize:"2.4vh",fontWeight:800,letterSpacing:-.5,color:T.text,margin:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{game.name}</h1>{guestMode&&<span style={{fontSize:10,fontWeight:700,color:T.success,background:T.success+"14",padding:"2px 6px",borderRadius:10,letterSpacing:.5,textTransform:"uppercase",flexShrink:0}}>🌐 Shared</span>}</div>
        <div style={{display:"flex",gap:4,alignItems:"center",flexShrink:0}}>
          <Btn onClick={doScramble} style={{borderColor:"#1a8faa",color:"#1a8faa",fontSize:12,padding:"6px 12px"}}>Scramble</Btn>
          <Btn onClick={reset} style={{borderColor:T.danger,color:T.danger,fontSize:12,padding:"6px 12px"}}>Reset</Btn>
          <Btn variant="ghost" onClick={toggleFS} style={{fontSize:12,padding:"6px 8px"}}>⛶</Btn>
          {!guestMode&&<Btn variant="ghost" onClick={onEdit} style={{fontSize:12,padding:"6px 8px"}}>✎</Btn>}
        </div>
      </div>
      {showSB&&<div style={{flexShrink:0,marginBottom:"0.4vh",position:"relative",zIndex:1}}><Scoreboard scores={scores} setScores={setScores} pointStep={pointStep}/></div>}
      <div style={{flex:1,position:"relative",minHeight:0,zIndex:1}}>
        <div style={{position:"absolute",inset:0,display:"grid",gridTemplateColumns:`repeat(${columns},1fr)`,gridTemplateRows:`repeat(${rows},1fr)`,gap:`${Math.min(.6,3/rows)}vh ${Math.min(.4,2/columns)}vw`}}>
          {order.slice(0,total).map(origIdx=>{
            const box=origIdx<boxes.length?boxes[origIdx]:null;const isV=visited[origIdx];
            if(!box)return<div key={origIdx} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,opacity:.06}}/>;
            const cat=categories[box.catIdx]||{name:"?",color:"#999"};
            const cellBg=cellBgCss(box,theme,T.surface);
            const borderColor=box.borderOverride||cat.color;
            const outerBorder=box.borderOverride||theme.cellBorder||T.border;
            const cellOpacity=box.cellOpacity!=null?box.cellOpacity:(theme.cellOpacity??1);
            const hasGrad=(box.bgOverrideType==="gradient"||(!box.bgOverride&&theme.cellType==="gradient"));
            return(<div key={origIdx} onClick={()=>!isV&&openQuestion(origIdx)}
              onContextMenu={e=>{e.preventDefault();if(isV)unvisit(origIdx)}}
              style={{
                background:isV?"#e5e4e0":cellBg,
                border:`1px solid ${outerBorder}`,
                borderRadius:10,
                borderLeft:`4px solid ${borderColor}`,
                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                gap:"0.3vh",
                transition:"transform .12s,box-shadow .12s,opacity .2s",
                userSelect:"none",overflow:"hidden",
                opacity:isV?0.2:cellOpacity,
                cursor:isV?"context-menu":"pointer",
                boxShadow:(!isV&&theme.cellShadow)?"0 4px 12px rgba(0,0,0,.2)":"none",
              }}>
              <span style={{fontWeight:800,fontSize:`clamp(.55rem,${cfv}vh,1.8rem)`,lineHeight:1.1,letterSpacing:-.3,color:isV?"#999":cat.color,textShadow:(!isV&&hasGrad)?"0 1px 2px rgba(255,255,255,.4)":"none",...(isV?strike:{})}}>{cat.name}</span>
              <span style={{fontWeight:500,fontSize:`clamp(.4rem,${sfv}vh,1.1rem)`,lineHeight:1.1,color:isV?"#bbb":T.textSoft,...(isV?strike:{})}}>{box.subtitle}</span>
            </div>);
          })}
        </div>
      </div>
    </div>);
}

/* ═══ LOGIN SCREEN ═══ */
function LoginScreen(){
  const[mode,setMode]=useState("login"); // login, signup, reset
  const[email,setEmail]=useState("");
  const[password,setPassword]=useState("");
  const[displayName,setDisplayName]=useState("");
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState(null);
  const[message,setMessage]=useState(null);

  const handleGoogle=async()=>{
    setLoading(true);setError(null);
    try{await signInWithPopup(auth,googleProvider)}
    catch(e){setError(e.message);setLoading(false)}
  };

  const handleEmailLogin=async(e)=>{
    e.preventDefault();setLoading(true);setError(null);
    try{await signInWithEmailAndPassword(auth,email,password)}
    catch(e){
      const msg=e.code==="auth/invalid-credential"?"Invalid email or password"
        :e.code==="auth/user-not-found"?"No account found with this email"
        :e.code==="auth/too-many-requests"?"Too many attempts, try again later"
        :e.message;
      setError(msg);setLoading(false);
    }
  };

  const handleSignUp=async(e)=>{
    e.preventDefault();setLoading(true);setError(null);
    if(password.length<6){setError("Password must be at least 6 characters");setLoading(false);return}
    try{
      const cred=await createUserWithEmailAndPassword(auth,email,password);
      if(displayName)await updateProfile(cred.user,{displayName});
    }catch(e){
      const msg=e.code==="auth/email-already-in-use"?"An account with this email already exists"
        :e.code==="auth/weak-password"?"Password is too weak"
        :e.message;
      setError(msg);setLoading(false);
    }
  };

  const handleReset=async(e)=>{
    e.preventDefault();setLoading(true);setError(null);setMessage(null);
    try{await sendPasswordResetEmail(auth,email);setMessage("Password reset email sent! Check your inbox.");setLoading(false)}
    catch(e){setError(e.code==="auth/user-not-found"?"No account found with this email":e.message);setLoading(false)}
  };

  const inp={width:"100%",padding:"12px 16px",border:`1.5px solid ${T.border}`,borderRadius:10,fontSize:15,outline:"none",fontFamily:T.font,color:T.text,background:T.surface,marginBottom:10};
  const link={background:"none",border:"none",fontSize:13,color:"#1a8faa",cursor:"pointer",fontFamily:T.font,textDecoration:"underline",padding:0};

  return(
    <div style={{minHeight:"100vh",background:T.bg,fontFamily:T.font,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{maxWidth:400,width:"100%",padding:"40px 24px"}}>
        <h1 style={{fontSize:36,fontWeight:900,color:T.text,letterSpacing:-1.5,margin:0,textAlign:"center"}}>Quiz Board</h1>
        <p style={{color:T.textSoft,fontSize:15,marginTop:8,marginBottom:28,textAlign:"center"}}>
          {mode==="login"?"Sign in to your account":mode==="signup"?"Create a new account":"Reset your password"}
        </p>

        {/* Google sign-in (always visible on login/signup) */}
        {mode!=="reset"&&<>
          <button onClick={handleGoogle} disabled={loading}
            style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,width:"100%",padding:"12px 20px",fontSize:15,fontWeight:700,fontFamily:T.font,cursor:loading?"wait":"pointer",
              background:T.surface,border:`1.5px solid ${T.border}`,borderRadius:50,color:T.text,transition:"all .15s",boxShadow:"0 2px 8px rgba(0,0,0,.06)",marginBottom:20}}>
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            Continue with Google
          </button>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
            <div style={{flex:1,height:1,background:T.border}}/><span style={{fontSize:12,color:T.textMuted,fontWeight:600}}>or</span><div style={{flex:1,height:1,background:T.border}}/>
          </div>
        </>}

        {/* Email/password form */}
        <form onSubmit={mode==="login"?handleEmailLogin:mode==="signup"?handleSignUp:handleReset}>
          {mode==="signup"&&<input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Your name" style={inp}/>}
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email address" required style={inp}/>
          {mode!=="reset"&&<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" required minLength={6} style={inp}/>}
          <button type="submit" disabled={loading}
            style={{width:"100%",padding:"12px 20px",fontSize:15,fontWeight:700,fontFamily:T.font,cursor:loading?"wait":"pointer",
              background:T.text,border:"none",borderRadius:50,color:"#fff",transition:"all .15s",marginBottom:12}}>
            {loading?"Please wait…":mode==="login"?"Sign in":mode==="signup"?"Create account":"Send reset link"}
          </button>
        </form>

        {error&&<p style={{color:T.danger,fontSize:13,textAlign:"center",marginBottom:8}}>{error}</p>}
        {message&&<p style={{color:T.success,fontSize:13,textAlign:"center",marginBottom:8}}>{message}</p>}

        <div style={{textAlign:"center",display:"flex",flexDirection:"column",gap:6,marginTop:8}}>
          {mode==="login"&&<><button onClick={()=>{setMode("signup");setError(null)}} style={link}>Don't have an account? Sign up</button><button onClick={()=>{setMode("reset");setError(null)}} style={link}>Forgot password?</button></>}
          {mode==="signup"&&<button onClick={()=>{setMode("login");setError(null)}} style={link}>Already have an account? Sign in</button>}
          {mode==="reset"&&<button onClick={()=>{setMode("login");setError(null);setMessage(null)}} style={link}>Back to sign in</button>}
        </div>
      </div>
    </div>
  );
}

/* ═══ APP ROOT ═══ */
export default function App(){
  const[user,setUser]=useState(undefined); // undefined=loading, null=logged out, object=logged in
  const[games,setGames]=useState([]);
  const[publishedIds,setPublishedIds]=useState(new Set());
  const[view,setView]=useState("home");
  const[activeGameId,setActiveGameId]=useState(null);
  const[playData,setPlayData]=useState(null);
  const[loading,setLoading]=useState(true);
  const[guestMode,setGuestMode]=useState(false); // true if viewing a public game without login

  useEffect(()=>{injectFont()},[]);

  // Check URL for public game link on initial load
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const publicGameId=params.get("game");
    if(publicGameId){
      setLoading(true);
      loadPublicGame(publicGameId).then(g=>{
        if(g){
          setPlayData(g);setView("play");setGuestMode(true);setLoading(false);
        }else{
          alert("This game is no longer available.");
          window.history.replaceState({},"",window.location.pathname);
          setLoading(false);
        }
      });
    }
  },[]);

  // Auth listener
  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,u=>{
      setUser(u);
      // Don't set loading false here if we're loading a public game
      if(!u&&!new URLSearchParams(window.location.search).get("game"))setLoading(false);
    });
    return unsub;
  },[]);

  // Load games when user signs in
  useEffect(()=>{
    if(!user)return;
    setLoading(true);
    Promise.all([
      loadGamesFromDB(user.uid),
      getDocs(collection(db,"public")).then(s=>new Set(s.docs.filter(d=>d.data()._ownerId===user.uid).map(d=>d.id))).catch(()=>new Set())
    ]).then(([g,pubs])=>{
      setPublishedIds(pubs);
      // Merge any localStorage games on first sign-in
      const local=loadGamesLocal();
      if(local.length>0){
        const existingIds=new Set(g.map(x=>x.id));
        const newLocal=local.filter(l=>!existingIds.has(l.id));
        if(newLocal.length>0){
          const merged=[...g,...newLocal];
          newLocal.forEach(l=>saveGameToDB(user.uid,l));
          localStorage.removeItem("qb_games");
          setGames(merged);setLoading(false);return;
        }
      }
      localStorage.removeItem("qb_games");
      setGames(g);setLoading(false);
    });
  },[user]);

  const activeGame=games.find(g=>g.id===activeGameId);

  const handleCreate=()=>{
    const g={...JSON.parse(JSON.stringify(DG)),id:uid()};
    setGames(p=>[g,...p]);
    if(user)saveGameToDB(user.uid,g);
    setActiveGameId(g.id);setView("editor");
  };
  const handleSelect=(id,mode)=>{
    setActiveGameId(id);
    if(mode==="play"){setPlayData(games.find(g=>g.id===id));setView("play")}
    else setView("editor");
  };
  const handleDuplicate=id=>{
    const o=games.find(g=>g.id===id);if(!o)return;
    const dup={...JSON.parse(JSON.stringify(o)),id:uid(),name:o.name+" (copy)"};
    setGames(p=>[dup,...p]);
    if(user)saveGameToDB(user.uid,dup);
  };
  const handleDelete=id=>{
    if(!window.confirm("Delete this game?"))return;
    setGames(p=>p.filter(g=>g.id!==id));
    if(user)deleteGameFromDB(user.uid,id);
    // Also unpublish if public
    if(publishedIds.has(id)){
      unpublishGame(id);
      setPublishedIds(p=>{const n=new Set(p);n.delete(id);return n});
    }
  };
  const handleImport=file=>importGameJSON(file,g=>{
    setGames(p=>[g,...p]);
    if(user)saveGameToDB(user.uid,g);
  });
  const handleEditorSave=u=>{
    setGames(p=>p.map(g=>g.id===u.id?u:g));
    if(user)saveGameToDB(user.uid,u);
  };
  const handlePlay=d=>{setPlayData(d);setView("play")};
  const handleSignOut=async()=>{await signOut(auth);setGames([]);setPublishedIds(new Set());setView("home")};

  // Publish/unpublish handlers
  const handlePublish=async(game)=>{
    if(!user)return false;
    const ok=await publishGame(user.uid,game);
    if(ok)setPublishedIds(p=>new Set(p).add(game.id));
    return ok;
  };
  const handleUnpublish=async(gameId)=>{
    if(!window.confirm("Unpublish this game? The shared link will stop working."))return;
    const ok=await unpublishGame(gameId);
    if(ok)setPublishedIds(p=>{const n=new Set(p);n.delete(gameId);return n});
  };
  const handleExitGuestMode=()=>{
    window.history.replaceState({},"",window.location.pathname);
    setGuestMode(false);setPlayData(null);setView("home");
  };

  // Show loading while auth state resolves
  if(user===undefined||loading)return(
    <div style={{minHeight:"100vh",background:T.bg,fontFamily:T.font,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <p style={{color:T.textSoft,fontSize:16}}>Loading…</p>
    </div>
  );

  // Guest mode: playing a public game without login
  if(guestMode&&playData)return<PlayBoard game={playData} onEdit={()=>{}} onHome={handleExitGuestMode} guestMode={true}/>;

  // Show login if not signed in
  if(!user)return<LoginScreen/>;

  if(view==="editor"&&activeGame)return<Editor game={activeGame} onSave={handleEditorSave} onPlay={handlePlay} onBack={()=>setView("home")}/>;
  if(view==="play"&&playData)return<PlayBoard game={playData} onEdit={()=>setView("editor")} onHome={()=>setView("home")}/>;
  return<Home games={games} onCreate={handleCreate} onSelect={handleSelect} onDuplicate={handleDuplicate} onDelete={handleDelete} onImport={handleImport} user={user} onSignOut={handleSignOut} publishedIds={publishedIds} onPublish={handlePublish} onUnpublish={handleUnpublish}/>;
}
