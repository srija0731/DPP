const $ = id => document.getElementById(id);
let map, mapData, routeLayers=[], obstacleLayers=[], startMarker=null, endMarker=null, pickMode=null;
let hazards=[], ownerUnlocked=false, lastPlan=null;
const defaultCenter=[17.405,78.445];

async function init(){
  map=L.map('map').setView(defaultCenter,12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
  try{
    const res=await fetch('/maps.json'); mapData=await res.json();
    hazards=mapData.obstacles.map(o=>({...o,enabled:true}));
    populatePlaces(); renderHazards(); renderLegend(); renderOwnerHazards();
    const a=mapData.places[0], b=mapData.places[4];
    setPoint('start',a.lat,a.lng); setPoint('end',b.lat,b.lng);
    const all=mapData.places.map(p=>[p.lat,p.lng]); map.fitBounds(all,{padding:[45,45]});
  }catch(e){alert('Could not load maps.json. Start the app using python main.py.');}
  $('startPlace').addEventListener('change',()=>syncPlace('start'));
  $('endPlace').addEventListener('change',()=>syncPlace('end'));
  $('rrtBtn').addEventListener('click',()=>plan('rrt'));
  $('dwaBtn').addEventListener('click',()=>plan('dwa'));
  $('pickStart').addEventListener('click',()=>setPick('start'));
  $('pickEnd').addEventListener('click',()=>setPick('end'));
  map.on('click',e=>{if(pickMode){setPoint(pickMode,e.latlng.lat,e.latlng.lng);pickMode=null;$('pickStart').classList.remove('primary');$('pickEnd').classList.remove('primary');}});
  $('showObstacles').addEventListener('change',renderHazards);
  $('showRoutes').addEventListener('change',()=>routeLayers.forEach(l=>l.setStyle?l.setStyle({opacity:$('showRoutes').checked?1:0}):null));
  $('ownerBtn').addEventListener('click',openOwner);
  $('closeOwner').addEventListener('click',()=> $('ownerModal').classList.add('hidden'));
  $('loginBtn').addEventListener('click',loginOwner);
  $('ownerPassword').addEventListener('keydown',e=>{if(e.key==='Enter')loginOwner()});
  $('logoutBtn').addEventListener('click',()=>{ownerUnlocked=false;$('ownerDashboard').classList.add('hidden');$('ownerLogin').classList.remove('hidden');$('ownerPassword').value='';});
}
function populatePlaces(){
  for(const id of ['startPlace','endPlace']){
    $(id).innerHTML='';
    mapData.places.forEach((p,i)=>{const op=document.createElement('option');op.value=i;op.textContent=p.name;$(id).appendChild(op);});
  }
  $('startPlace').value='0';$('endPlace').value='4';
}
function syncPlace(which){
  const p=mapData.places[Number($(which+'Place').value)];
  setPoint(which,p.lat,p.lng);
}
function setPoint(which,lat,lng){
  $(which+'Lat').value=Number(lat).toFixed(6);$(which+'Lng').value=Number(lng).toFixed(6);
  const ll=[Number(lat),Number(lng)];
  if(which==='start'){
    if(startMarker)map.removeLayer(startMarker);
    startMarker=L.marker(ll,{draggable:true}).addTo(map).bindPopup('Start point');
    startMarker.on('dragend',()=>{const p=startMarker.getLatLng();$('startLat').value=p.lat.toFixed(6);$('startLng').value=p.lng.toFixed(6);});
  }else{
    if(endMarker)map.removeLayer(endMarker);
    endMarker=L.marker(ll,{draggable:true}).addTo(map).bindPopup('Destination');
    endMarker.on('dragend',()=>{const p=endMarker.getLatLng();$('endLat').value=p.lat.toFixed(6);$('endLng').value=p.lng.toFixed(6);});
  }
}
function setPick(which){pickMode=which;$('pickStart').classList.toggle('primary',which==='start');$('pickEnd').classList.toggle('primary',which==='end');}
function getPoint(which){
  const lat=Number($(which+'Lat').value),lng=Number($(which+'Lng').value);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat>90||lng < -180||lng>180)throw new Error('Enter valid GPS latitude and longitude values.');
  return {lat,lng};
}
function activeHazards(){return hazards.filter(h=>h.enabled);}
async function plan(algorithm){
  let start,end;
  try{start=getPoint('start');end=getPoint('end');}catch(e){alert(e.message);return;}
  const button=$(algorithm==='rrt'?'rrtBtn':'dwaBtn');button.disabled=true;button.textContent='Calculating…';
  $('resultSubtitle').textContent='Running '+algorithm.toUpperCase()+' planner';
  try{
    const response=await fetch('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start,end,algorithm,obstacles:activeHazards()})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Planning failed');
    lastPlan=data;drawRoutes(data);showResults(data);
  }catch(e){$('results').innerHTML='<div class="empty-state"></div>'; $('results').firstChild.textContent=e.message;$('resultSubtitle').textContent='No route generated';}
  finally{button.disabled=false;button.textContent=algorithm==='rrt'?'⌁ Calculate RRT routes':'➤ Calculate DWA route';}
}
function clearRoutes(){routeLayers.forEach(l=>map.removeLayer(l));routeLayers=[];}
function drawRoutes(data){
  clearRoutes();
  data.routes.forEach((coords,i)=>{
    const latlngs=coords.map(p=>[p[1],p[0]]);
    if(data.algorithm==='RRT' && i!==0){
      const layer=L.polyline(latlngs,{color:'#438eff',weight:4,opacity:.78,dashArray:'7 5'}).addTo(map);routeLayers.push(layer);
    }
  });
  const optimal=L.polyline(data.optimal.map(p=>[p[1],p[0]]),{color:'#12a96d',weight:6,opacity:1,lineCap:'round',lineJoin:'round'}).addTo(map);
  routeLayers.push(optimal);
  if($('showRoutes').checked)map.fitBounds(optimal.getBounds(),{padding:[70,70]});
  else routeLayers.forEach(l=>l.setStyle&&l.setStyle({opacity:0}));
}
function showResults(data){
  $('resultSubtitle').textContent=data.routes.length+' route'+(data.routes.length===1?'':'s')+' generated';
  $('results').innerHTML='';
  data.routes.forEach((route,i)=>{
    const card=document.createElement('div');card.className='route-result'+(i===0?' best':'');
    const title=document.createElement('b');title.textContent=(i===0?'Selected optimal path':'Candidate route '+(i+1));
    if(i===0){const tag=document.createElement('span');tag.className='best-tag';tag.textContent='OPTIMAL';title.appendChild(tag);}
    const small=document.createElement('small');small.textContent=`${data.algorithm} · approximate map distance ${data.lengths[i]} m · ${route.length} waypoints`;
    card.append(title,small);$('results').appendChild(card);
  });
}
function renderHazards(){
  obstacleLayers.forEach(l=>map.removeLayer(l));obstacleLayers=[];
  if(!$('showObstacles').checked)return;
  hazards.filter(h=>h.enabled).forEach(h=>{
    const radius=Math.max(18,Number(h.radius||.0002)*111000);
    const c=L.circle([h.lat,h.lng],{radius,color:'#ff647c',fillColor:'#ff647c',fillOpacity:.18,weight:2}).addTo(map).bindPopup(`<b>${escapeHtml(h.name)}</b><br>${escapeHtml(h.kind||'hazard')} (simulated)`);
    obstacleLayers.push(c);
  });
}
function renderLegend(){
  $('obstacleLegend').innerHTML='';
  (mapData.obstacles||[]).forEach(h=>{const row=document.createElement('div');row.className='legend-item';const dot=document.createElement('i');dot.className='legend-dot';dot.style.background=h.kind==='bird'?'#f7bd4b':h.kind==='tower'?'#b58cff':'#ff647c';const txt=document.createElement('span');txt.textContent=h.name+' · simulated';row.append(dot,txt);$('obstacleLegend').appendChild(row);});
}
function renderOwnerHazards(){
  $('ownerHazards').innerHTML='';
  hazards.forEach((h,i)=>{
    const row=document.createElement('label');row.className='hazard-row';row.textContent=h.name+' ('+h.kind+')';
    const cb=document.createElement('input');cb.type='checkbox';cb.checked=h.enabled;cb.addEventListener('change',()=>{hazards[i].enabled=cb.checked;renderHazards();});
    row.appendChild(cb);$('ownerHazards').appendChild(row);
  });
}
function openOwner(){
  $('ownerModal').classList.remove('hidden');
  $('ownerLogin').classList.toggle('hidden',ownerUnlocked);
  $('ownerDashboard').classList.toggle('hidden',!ownerUnlocked);
  if(ownerUnlocked)$('droneStatus').textContent=lastPlan?'Route calculated (simulated)':'Standby';
}
function loginOwner(){
  // Demo-only: production authentication must be enforced server-side.
  if($('ownerPassword').value===mapData.owner_demo_password){
    ownerUnlocked=true;$('loginError').textContent='';$('ownerLogin').classList.add('hidden');$('ownerDashboard').classList.remove('hidden');
    $('droneStatus').textContent=lastPlan?'Route calculated (simulated)':'Standby';renderOwnerHazards();
  }else $('loginError').textContent='Incorrect password. Try the demo password shown above.';
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
init();
