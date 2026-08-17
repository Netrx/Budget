const MONTHS=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DEFAULT_EXPENSE_CATEGORIES=Array.from({length:12},(_,i)=>({id:uid(),name:`Категория ${String(i+1).padStart(2,'0')}`,subcategories:Array.from({length:20},(_,j)=>({id:uid(),name:`Подкатегория ${String(i+1).padStart(2,'0')}.${String(j+1).padStart(2,'0')}`}))}));
const DEFAULT_INCOME_CATEGORIES=[{id:uid(),name:'Зарплата'},{id:uid(),name:'Заказы'},{id:uid(),name:'Продажи'},{id:uid(),name:'Прочие доходы'}];
const DEFAULT_DEBT_CATEGORIES=[{id:uid(),name:'Ежемесячные расходы',showOnDashboard:true},{id:uid(),name:'Кредиты',showOnDashboard:true},{id:uid(),name:'Рассрочки',showOnDashboard:false},{id:uid(),name:'Прочие долги',showOnDashboard:false}];
const STORE_KEY='budget_mobile_v2';
const LEGACY_STORE_KEY='budget_mobile_v1';
let state=loadState();
let transactionType='expense';
let deferredPrompt=null;
let pendingPhoto='';
let reportSelectedCategories=new Set();

const $=s=>document.querySelector(s); const $$=s=>[...document.querySelectorAll(s)];
function uid(){return crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)}
function localDate(){const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10)}
function money(n){return new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(Number(n)||0)}
function saveState(){localStorage.setItem(STORE_KEY,JSON.stringify(state))}
function clone(v){return JSON.parse(JSON.stringify(v))}

function normalizeState(data){
  const raw=data&&typeof data==='object'?data:{};
  const legacyCats=Array.isArray(raw.categories)?raw.categories:[];
  const expenseCategories=Array.isArray(raw.expenseCategories)?raw.expenseCategories:legacyCats;
  const normalizedExpenses=(expenseCategories.length?expenseCategories:clone(DEFAULT_EXPENSE_CATEGORIES)).map(c=>({
    id:c.id||uid(),name:String(c.name||'Без названия'),subcategories:(Array.isArray(c.subcategories)?c.subcategories:[]).map(s=>typeof s==='string'?{id:uid(),name:s}:{id:s.id||uid(),name:String(s.name||'Без названия')})
  }));
  const incomeCategories=(Array.isArray(raw.incomeCategories)&&raw.incomeCategories.length?raw.incomeCategories:clone(DEFAULT_INCOME_CATEGORIES)).map(c=>typeof c==='string'?{id:uid(),name:c}:{id:c.id||uid(),name:String(c.name||'Без названия')});
  const transactions=(Array.isArray(raw.transactions)?raw.transactions:[]).map(t=>{
    const tx={...t,id:t.id||uid(),amount:Number(t.amount)||0,photo:t.photo||''};
    if(tx.type==='expense'){
      const cat=normalizedExpenses.find(c=>c.id===tx.categoryId)||normalizedExpenses.find(c=>c.name===tx.category);
      const sub=cat?.subcategories.find(s=>s.id===tx.subcategoryId)||cat?.subcategories.find(s=>s.name===tx.subcategory);
      tx.categoryId=tx.categoryId||cat?.id||'';tx.categoryName=tx.categoryName||tx.category||cat?.name||'Удалённая категория';
      tx.subcategoryId=tx.subcategoryId||sub?.id||'';tx.subcategoryName=tx.subcategoryName||tx.subcategory||sub?.name||'';
    }else{
      const inc=incomeCategories.find(c=>c.id===tx.incomeCategoryId)||incomeCategories.find(c=>c.name===tx.incomeCategoryName);
      tx.incomeCategoryId=tx.incomeCategoryId||inc?.id||incomeCategories[0]?.id||'';
      tx.incomeCategoryName=tx.incomeCategoryName||inc?.name||incomeCategories[0]?.name||'Доход';
      tx.source=tx.source||'Источник дохода';
    }
    return tx;
  });
  const debtCategories=(Array.isArray(raw.debtCategories)&&raw.debtCategories.length?raw.debtCategories:clone(DEFAULT_DEBT_CATEGORIES)).map(c=>typeof c==='string'?{id:uid(),name:c,showOnDashboard:false}:{id:c.id||uid(),name:String(c.name||'Без названия'),showOnDashboard:Boolean(c.showOnDashboard)});
  const debts=(Array.isArray(raw.debts)?raw.debts:[]).map(d=>{const cat=debtCategories.find(c=>c.id===d.categoryId)||debtCategories.find(c=>c.name===d.categoryName);const amount=Number(d.amount)||0;const reserved=Math.min(amount,Math.max(0,Number(d.reserved)||0));return{...d,id:d.id||uid(),title:String(d.title||'Долг'),amount,reserved,paid:Boolean(d.paid)||reserved>=amount,categoryId:d.categoryId||cat?.id||'',categoryName:d.categoryName||cat?.name||'Удалённая категория',dueDate:d.dueDate||'',comment:d.comment||'',createdAt:d.createdAt||d.dueDate||localDate(),recurringSeriesId:d.recurringSeriesId||'',recurringMonth:d.recurringMonth||'',recurringEnabled:d.recurringEnabled===undefined?Boolean(d.recurringSeriesId):Boolean(d.recurringEnabled)}});
  const recurringTemplates=new Set();
  debts.filter(d=>d.recurringSeriesId&&d.recurringEnabled).sort((a,b)=>String(a.recurringMonth||a.dueDate||a.createdAt).localeCompare(String(b.recurringMonth||b.dueDate||b.createdAt))).forEach(d=>{if(recurringTemplates.has(d.recurringSeriesId))d.recurringEnabled=false;else recurringTemplates.add(d.recurringSeriesId)});
  return{version:6,expenseCategories:normalizedExpenses,incomeCategories,debtCategories,transactions,debts};
}
function loadState(){
  try{const raw=localStorage.getItem(STORE_KEY)||localStorage.getItem(LEGACY_STORE_KEY);if(raw)return normalizeState(JSON.parse(raw))}catch(e){}
  return normalizeState({});
}

function init(){
  $('#entryDate').value=localDate();
  bindNavigation();bindEntryForm();bindTransactions();bindSettings();bindDashboard();bindDebts();bindPhotoDialog();bindInstall();
  refreshSelectors();generateMonthlyDebts();renderAll();saveState();
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js');
}
function bindNavigation(){
  $$('.nav-btn').forEach(btn=>btn.addEventListener('click',()=>{
    $$('.nav-btn').forEach(x=>x.classList.remove('active'));btn.classList.add('active');
    $$('.screen').forEach(x=>x.classList.remove('active'));$('#'+btn.dataset.screen).classList.add('active');
    if(btn.dataset.screen==='transactions')renderTransactions();
    if(btn.dataset.screen==='settings')renderCategoryEditors();
    if(btn.dataset.screen==='debts')renderDebts();
  }));
}
function bindDashboard(){
  $('#periodPreset').addEventListener('change',()=>{const custom=$('#periodPreset').value==='custom';$('#dateFromLabel').classList.toggle('hidden',!custom);$('#dateToLabel').classList.toggle('hidden',!custom);renderDashboard()});
  $('#filterDateFrom').addEventListener('change',renderDashboard);$('#filterDateTo').addEventListener('change',renderDashboard);
}
function bindEntryForm(){
  $$('[data-entry-type]').forEach(btn=>btn.addEventListener('click',()=>{
    $$('[data-entry-type]').forEach(x=>x.classList.remove('active'));btn.classList.add('active');
    $('#entryType').value=btn.dataset.entryType;$('#expenseFields').classList.toggle('hidden',btn.dataset.entryType!=='expense');$('#incomeFields').classList.toggle('hidden',btn.dataset.entryType!=='income');
  }));
  $('#entryExpenseCategory').addEventListener('change',refreshSubcategories);
  $('#entryPhoto').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{pendingPhoto=await compressImage(f);showPhotoPreview()}catch(err){alert('Не удалось обработать фотографию')}});
  $('#removePhotoBtn').addEventListener('click',()=>{pendingPhoto='';$('#entryPhoto').value='';showPhotoPreview()});
  $('#entryForm').addEventListener('submit',e=>{
    e.preventDefault();const type=$('#entryType').value;const amount=Number($('#entryAmount').value);if(!amount||amount<=0)return;
    const tx={id:uid(),type,date:$('#entryDate').value,amount,description:$('#entryDescription').value.trim(),comment:$('#entryComment').value.trim(),photo:pendingPhoto};
    if(type==='expense'){
      const cat=state.expenseCategories.find(c=>c.id===$('#entryExpenseCategory').value);const sub=cat?.subcategories.find(s=>s.id===$('#entrySubcategory').value);
      tx.categoryId=cat?.id||'';tx.categoryName=cat?.name||'Без категории';tx.subcategoryId=sub?.id||'';tx.subcategoryName=sub?.name||'';
    }else{
      const cat=state.incomeCategories.find(c=>c.id===$('#entryIncomeCategory').value);tx.incomeCategoryId=cat?.id||'';tx.incomeCategoryName=cat?.name||'Доход';tx.source=$('#entrySource').value.trim()||'Источник дохода';
    }
    state.transactions.push(tx);saveState();e.target.reset();pendingPhoto='';showPhotoPreview();$('#entryDate').value=localDate();$('#entryType').value=type;refreshSelectors();renderAll();document.querySelector('[data-screen="dashboard"]').click();
  });
}
function bindTransactions(){
  $$('[data-type]').forEach(btn=>btn.addEventListener('click',()=>{transactionType=btn.dataset.type;reportSelectedCategories.clear();$$('[data-type]').forEach(x=>x.classList.remove('active'));btn.classList.add('active');renderTransactions()}));
  $('#reportDateFrom').addEventListener('change',renderTransactions);$('#reportDateTo').addEventListener('change',renderTransactions);
  $('#clearReportFilters').addEventListener('click',()=>{$('#reportDateFrom').value='';$('#reportDateTo').value='';reportSelectedCategories.clear();renderTransactions()});
}
function bindSettings(){
  const addExpenseBtn=$('#addExpenseCategoryBtn');
  const addIncomeBtn=$('#addIncomeCategoryBtn');
  const addDebtBtn=$('#addDebtCategoryBtn');
  if(addExpenseBtn)addExpenseBtn.addEventListener('click',()=>{state.expenseCategories.push({id:uid(),name:`Категория ${String(state.expenseCategories.length+1).padStart(2,'0')}`,subcategories:[{id:uid(),name:'Подкатегория 01'}]});saveState();refreshSelectors();renderCategoryEditors()});
  if(addIncomeBtn)addIncomeBtn.addEventListener('click',()=>{state.incomeCategories.push({id:uid(),name:`Доход ${String(state.incomeCategories.length+1).padStart(2,'0')}`});saveState();refreshSelectors();renderCategoryEditors()});
  if(addDebtBtn)addDebtBtn.addEventListener('click',addDebtCategory);
  $('#exportBtn').addEventListener('click',()=>{const backup={...state,version:6,exportedAt:new Date().toISOString(),app:'Мой бюджет'};const b=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=`budget-backup-${localDate()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
  $('#importInput').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const data=JSON.parse(await f.text());if(!Array.isArray(data.transactions))throw new Error();if(!confirm('Импорт заменит текущие данные. Продолжить?'))return;state=normalizeState(data);saveState();reportSelectedCategories.clear();refreshSelectors();renderAll();alert('Данные и фотографии импортированы')}catch(err){alert('Не удалось импортировать файл. Проверьте, что это резервная копия приложения.')}finally{e.target.value=''}});
  $('#clearBtn').addEventListener('click',()=>{if(confirm('Удалить все операции, включая фотографии?')){state.transactions=[];saveState();renderAll()}});
}
function bindPhotoDialog(){$('#closePhotoDialog').addEventListener('click',()=>$('#photoDialog').close());$('#photoDialog').addEventListener('click',e=>{if(e.target===$('#photoDialog'))$('#photoDialog').close()})}
function bindInstall(){window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('#installBtn').classList.remove('hidden')});$('#installBtn').addEventListener('click',async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('#installBtn').classList.add('hidden')})}

function refreshSelectors(){
  $('#entryExpenseCategory').innerHTML=state.expenseCategories.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  $('#entryIncomeCategory').innerHTML=state.incomeCategories.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  $('#debtCategory').innerHTML=state.debtCategories.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');refreshSubcategories();
}
function refreshSubcategories(){const cat=state.expenseCategories.find(c=>c.id===$('#entryExpenseCategory').value)||state.expenseCategories[0];$('#entrySubcategory').innerHTML=(cat?.subcategories||[]).map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}
function showPhotoPreview(){$('#photoPreviewWrap').classList.toggle('hidden',!pendingPhoto);if(pendingPhoto)$('#photoPreview').src=pendingPhoto}
async function compressImage(file){
  if(file.size>20*1024*1024)throw new Error('too large');const bitmap=await createImageBitmap(file);const max=1280;const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();return canvas.toDataURL('image/jpeg',.78)
}

function getDashboardRange(){
  const preset=$('#periodPreset').value;const now=new Date();let from='',to='';
  if(preset==='month'){from=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;to=localDate()}
  if(preset==='year'){from=`${now.getFullYear()}-01-01`;to=localDate()}
  if(preset==='custom'){from=$('#filterDateFrom').value;to=$('#filterDateTo').value}
  return{from,to,label:preset==='all'?'Всё время':preset==='month'?'Текущий месяц':preset==='year'?'Текущий год':formatRange(from,to)};
}
function inRange(t,from,to){return(!from||t.date>=from)&&(!to||t.date<=to)}
function renderAll(){renderDashboard();renderTransactions();renderDebts();renderCategoryEditors()}
function renderDashboard(){
  const range=getDashboardRange();const tx=state.transactions.filter(t=>inRange(t,range.from,range.to));const incomes=tx.filter(t=>t.type==='income');const expenses=tx.filter(t=>t.type==='expense');
  const inc=sum(incomes),exp=sum(expenses);$('#metricIncome').textContent=money(inc);$('#metricExpense').textContent=money(exp);$('#metricBalance').textContent=money(inc-exp);$('#metricAvgIncome').textContent=money(incomes.length?inc/incomes.length:0);$('#metricAvgExpense').textContent=money(expenses.length?exp/expenses.length:0);$('#periodLabel').textContent=range.label;
  const buckets=monthlyBuckets(tx,range);drawGroupedBars($('#monthChart'),buckets,'income','expense');
  drawHorizontalBars($('#expenseCategoryChart'),categoryTotals(expenses,'expense'));
  drawHorizontalBars($('#incomeCategoryChart'),categoryTotals(incomes,'income'),'#15803d');
  renderDebtDashboard();
}
function monthlyBuckets(tx,range){
  const keys=[...new Set(tx.map(t=>t.date.slice(0,7)))].sort();if(!keys.length){const d=new Date();keys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)}
  return keys.slice(-24).map(k=>{const [y,m]=k.split('-').map(Number);const items=tx.filter(t=>t.date.startsWith(k));return{label:`${MONTHS[m-1].slice(0,3)} ${String(y).slice(2)}`,income:sum(items.filter(t=>t.type==='income')),expense:sum(items.filter(t=>t.type==='expense'))}})
}
function categoryTotals(items,type){
  const map=new Map();items.forEach(t=>{const name=type==='expense'?(t.categoryName||'Удалённая категория'):(t.incomeCategoryName||'Без категории');map.set(name,(map.get(name)||0)+t.amount)});return[...map].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value)
}
function sum(items){return items.reduce((s,t)=>s+(Number(t.amount)||0),0)}

function renderTransactions(){
  renderReportCategoryFilters();const from=$('#reportDateFrom').value,to=$('#reportDateTo').value;
  const items=state.transactions.filter(t=>t.type===transactionType&&inRange(t,from,to)&&(!reportSelectedCategories.size||reportSelectedCategories.has(categoryKey(t)))).sort((a,b)=>b.date.localeCompare(a.date));
  $('#reportTotal').textContent=money(sum(items));const list=$('#transactionList');list.innerHTML='';if(!items.length){list.innerHTML='<div class="empty">Операций по выбранным фильтрам нет</div>';return}
  items.forEach(t=>{const node=$('#transactionTemplate').content.cloneNode(true);node.querySelector('.tx-title').textContent=t.type==='expense'?(t.subcategoryName||t.categoryName):(t.source||t.incomeCategoryName||'Доход');node.querySelector('.tx-meta').textContent=`${formatDate(t.date)} · ${t.type==='expense'?(t.categoryName||'Удалённая категория'):(t.incomeCategoryName||'Без категории')} · ${t.description||'Без описания'}`;node.querySelector('.tx-comment').textContent=t.comment||'';node.querySelector('.tx-comment').classList.toggle('hidden',!t.comment);const amount=node.querySelector('.tx-amount');amount.textContent=(t.type==='expense'?'− ':'+ ')+money(t.amount);amount.classList.add(t.type);
    if(t.photo){const btn=node.querySelector('.tx-photo-button');btn.classList.remove('hidden');btn.querySelector('img').src=t.photo;btn.addEventListener('click',()=>{$('#dialogPhoto').src=t.photo;$('#photoDialog').showModal()})}
    node.querySelector('.delete-btn').addEventListener('click',()=>{if(confirm('Удалить эту операцию?')){state.transactions=state.transactions.filter(x=>x.id!==t.id);saveState();renderAll()}});list.append(node)
  });
}
function categoryKey(t){return t.type==='expense'?(t.categoryName||'Удалённая категория'):(t.incomeCategoryName||'Без категории')}
function renderReportCategoryFilters(){
  const root=$('#reportCategoryFilters');const names=[...new Set(state.transactions.filter(t=>t.type===transactionType).map(categoryKey))].sort((a,b)=>a.localeCompare(b,'ru'));root.innerHTML='';
  if(!names.length){root.innerHTML='<span class="muted-inline">Нет категорий</span>';return}
  names.forEach(name=>{const label=document.createElement('label');label.className='check-chip';const input=document.createElement('input');input.type='checkbox';input.checked=reportSelectedCategories.has(name);input.addEventListener('change',()=>{input.checked?reportSelectedCategories.add(name):reportSelectedCategories.delete(name);renderTransactions()});const span=document.createElement('span');span.textContent=name;label.append(input,span);root.append(label)})
}

function renderCategoryEditors(){renderExpenseCategoryEditor();renderIncomeCategoryEditor();renderDebtCategoryEditor()}
function renderExpenseCategoryEditor(){
  const root=$('#expenseCategoryEditor');root.innerHTML='';state.expenseCategories.forEach(cat=>{const block=document.createElement('div');block.className='category-block';const row=document.createElement('div');row.className='category-row';const input=document.createElement('input');input.value=cat.name;input.addEventListener('change',()=>{cat.name=input.value.trim()||cat.name;saveState();refreshSelectors();renderAll()});const add=miniButton('＋',()=>{cat.subcategories.push({id:uid(),name:`Подкатегория ${String(cat.subcategories.length+1).padStart(2,'0')}`});saveState();renderCategoryEditors();refreshSelectors()});const del=miniButton('Удалить',()=>deleteExpenseCategory(cat),true);row.append(input,add,del);block.append(row);
    const sub=document.createElement('div');sub.className='sub-list';cat.subcategories.forEach(s=>{const chip=document.createElement('div');chip.className='sub-chip';const inp=document.createElement('input');inp.value=s.name;inp.addEventListener('change',()=>{s.name=inp.value.trim()||s.name;saveState();refreshSelectors();renderAll()});const sdel=document.createElement('button');sdel.type='button';sdel.className='delete-btn';sdel.textContent='×';sdel.addEventListener('click',()=>{cat.subcategories=cat.subcategories.filter(x=>x.id!==s.id);saveState();renderCategoryEditors();refreshSelectors()});chip.append(inp,sdel);sub.append(chip)});block.append(sub);root.append(block)})
}
function renderIncomeCategoryEditor(){const root=$('#incomeCategoryEditor');root.innerHTML='';state.incomeCategories.forEach(cat=>{const row=document.createElement('div');row.className='category-row simple-category';const input=document.createElement('input');input.value=cat.name;input.addEventListener('change',()=>{cat.name=input.value.trim()||cat.name;saveState();refreshSelectors();renderAll()});row.append(input,miniButton('Удалить',()=>deleteIncomeCategory(cat),true));root.append(row)})}
function miniButton(text,fn,danger=false){const b=document.createElement('button');b.type='button';b.className=danger?'mini-btn mini-danger':'mini-btn';b.textContent=text;b.addEventListener('click',fn);return b}
function deleteExpenseCategory(cat){if(!confirm(`Удалить категорию «${cat.name}» из списка? Старые операции сохранят её название.`))return;state.expenseCategories=state.expenseCategories.filter(c=>c.id!==cat.id);saveState();refreshSelectors();renderAll()}
function deleteIncomeCategory(cat){if(!confirm(`Удалить категорию дохода «${cat.name}» из списка? Старые операции останутся в отчётах.`))return;state.incomeCategories=state.incomeCategories.filter(c=>c.id!==cat.id);saveState();refreshSelectors();renderAll()}

function drawGroupedBars(canvas,data,key1,key2){const ctx=canvas.getContext('2d'),dpr=devicePixelRatio||1,w=canvas.clientWidth||800,h=Math.max(260,w*.46);canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);const max=Math.max(1,...data.flatMap(x=>[x[key1],x[key2]]));const pad={l:34,r:10,t:20,b:40},cw=w-pad.l-pad.r,ch=h-pad.t-pad.b,group=cw/data.length,bw=Math.max(3,Math.min(18,group*.28));ctx.font='11px system-ui';ctx.textAlign='center';data.forEach((x,i)=>{const cx=pad.l+i*group+group/2,h1=x[key1]/max*ch,h2=x[key2]/max*ch;ctx.fillStyle='#15803d';ctx.fillRect(cx-bw-1,pad.t+ch-h1,bw,h1);ctx.fillStyle='#dc2626';ctx.fillRect(cx+1,pad.t+ch-h2,bw,h2);ctx.save();ctx.translate(cx,h-10);if(data.length>10)ctx.rotate(-.55);ctx.fillStyle='#64748b';ctx.fillText(x.label,0,0);ctx.restore()});ctx.fillStyle='#15803d';ctx.fillRect(pad.l,2,10,10);ctx.fillStyle='#334155';ctx.textAlign='left';ctx.fillText('Доходы',pad.l+15,11);ctx.fillStyle='#dc2626';ctx.fillRect(pad.l+80,2,10,10);ctx.fillStyle='#334155';ctx.fillText('Расходы',pad.l+95,11)}
function drawHorizontalBars(canvas,data,color='#2563eb'){const ctx=canvas.getContext('2d'),dpr=devicePixelRatio||1,w=canvas.clientWidth||800,h=Math.max(180,data.length*36+30);canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);if(!data.length){ctx.fillStyle='#64748b';ctx.font='14px system-ui';ctx.fillText('Нет данных за выбранный период',12,28);return}const max=Math.max(...data.map(x=>x.value)),labelW=Math.min(190,w*.46);ctx.font='12px system-ui';data.forEach((x,i)=>{const y=18+i*36;ctx.fillStyle='#334155';ctx.textAlign='left';ctx.fillText(shorten(x.label,28),8,y+12);const barW=Math.max(2,(w-labelW-80)*(x.value/max));ctx.fillStyle=color;ctx.fillRect(labelW,y,barW,17);ctx.fillStyle='#64748b';ctx.fillText(compact(x.value),labelW+barW+6,y+12)})}
function compact(n){return new Intl.NumberFormat('ru-RU',{notation:'compact',maximumFractionDigits:1}).format(n)}
function formatDate(s){return new Intl.DateTimeFormat('ru-RU').format(new Date(s+'T00:00:00'))}
function formatRange(from,to){return from&&to?`${formatDate(from)} — ${formatDate(to)}`:from?`С ${formatDate(from)}`:to?`По ${formatDate(to)}`:'Укажите даты'}
function shorten(s,n){s=String(s||'');return s.length>n?s.slice(0,n-1)+'…':s}
function escapeHtml(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}


function bindDebts(){
  $('#cancelDebtEditBtn').addEventListener('click',resetDebtForm);
  $('#debtForm').addEventListener('submit',e=>{
    e.preventDefault();const amount=Number($('#debtAmount').value);if(!amount||amount<=0)return;
    const editId=$('#debtEditId').value;const existing=state.debts.find(d=>d.id===editId);
    const cat=state.debtCategories.find(c=>c.id===$('#debtCategory').value);let reserved=Math.max(0,Number($('#debtReserved').value)||0);reserved=Math.min(amount,reserved);const paid=$('#debtPaid').checked;
    const dueDate=$('#debtDueDate').value;const createdAt=existing?.createdAt||localDate();const recurringEnabled=$('#debtMonthly').checked;
    const recurringSeriesId=recurringEnabled?(existing?.recurringSeriesId||uid()):'';const recurringMonth=recurringEnabled?monthKey(dueDate||createdAt):'';
    if(existing?.recurringSeriesId&&!recurringEnabled)state.debts.filter(d=>d.recurringSeriesId===existing.recurringSeriesId).forEach(d=>d.recurringEnabled=false);
    const record={id:existing?.id||uid(),title:$('#debtTitle').value.trim()||'Долг',categoryId:cat?.id||'',categoryName:cat?.name||existing?.categoryName||'Без категории',amount,reserved:paid?amount:reserved,paid,dueDate,comment:$('#debtComment').value.trim(),createdAt,recurringSeriesId,recurringMonth,recurringEnabled};
    if(existing)Object.assign(existing,record);else state.debts.push(record);
    saveState();resetDebtForm();generateMonthlyDebts();renderAll();
  });
}
function resetDebtForm(){
  const form=$('#debtForm');form.reset();$('#debtEditId').value='';$('#debtReserved').value='0';$('#debtFormTitle').textContent='Добавить долг или обязательство';$('#saveDebtBtn').textContent='Сохранить долг';$('#cancelDebtEditBtn').classList.add('hidden');refreshSelectors();$('#debtMonthly').checked=false;
}
function editDebt(d){
  $('#debtEditId').value=d.id;$('#debtTitle').value=d.title;$('#debtCategory').value=d.categoryId;$('#debtAmount').value=d.amount;$('#debtDueDate').value=d.dueDate||'';$('#debtReserved').value=d.paid?d.amount:(d.reserved||0);$('#debtComment').value=d.comment||'';$('#debtPaid').checked=Boolean(d.paid);$('#debtMonthly').checked=Boolean(d.recurringEnabled);$('#debtFormTitle').textContent='Редактировать долг';$('#saveDebtBtn').textContent='Сохранить изменения';$('#cancelDebtEditBtn').classList.remove('hidden');$('#debtForm').scrollIntoView({behavior:'smooth',block:'start'});setTimeout(()=>$('#debtTitle').focus(),250);
}

function monthKey(dateString){
  const d=dateString?new Date(dateString+'T00:00:00'):new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function addMonthsSafe(dateString,months){
  const source=dateString?new Date(dateString+'T00:00:00'):new Date();
  const day=source.getDate();
  const target=new Date(source.getFullYear(),source.getMonth()+months,1);
  const lastDay=new Date(target.getFullYear(),target.getMonth()+1,0).getDate();
  target.setDate(Math.min(day,lastDay));
  target.setMinutes(target.getMinutes()-target.getTimezoneOffset());
  return target.toISOString().slice(0,10);
}
function monthDistance(fromMonth,toMonth){
  const [fy,fm]=fromMonth.split('-').map(Number);const [ty,tm]=toMonth.split('-').map(Number);
  return (ty-fy)*12+(tm-fm);
}
function generateMonthlyDebts(){
  if(!Array.isArray(state.debts)||!Array.isArray(state.debtCategories))return;
  const currentMonth=monthKey(localDate());
  const seriesSeeds=new Map();
  state.debts.forEach(d=>{
    if(!d.recurringEnabled||!d.recurringSeriesId)return;
    const key=d.recurringSeriesId;const existing=seriesSeeds.get(key);
    const dMonth=d.recurringMonth||monthKey(d.dueDate||d.createdAt||localDate());
    d.recurringMonth=dMonth;
    if(!existing||dMonth<existing.recurringMonth)seriesSeeds.set(key,d);
  });
  seriesSeeds.forEach(seed=>{
    const startMonth=seed.recurringMonth||monthKey(seed.dueDate||seed.createdAt||localDate());
    const count=monthDistance(startMonth,currentMonth);
    if(count<=0)return;
    for(let i=1;i<=count;i++){
      const dueDate=seed.dueDate?addMonthsSafe(seed.dueDate,i):'';
      const targetMonth=monthKey(dueDate||addMonthsSafe((seed.createdAt||localDate()),i));
      const exists=state.debts.some(d=>d.recurringSeriesId===seed.recurringSeriesId&&d.recurringMonth===targetMonth);
      if(exists)continue;
      state.debts.push({...seed,id:uid(),reserved:0,paid:false,dueDate,createdAt:localDate(),recurringMonth:targetMonth,recurringEnabled:false});
    }
  });
}

function debtRemaining(d){return Math.max(0,(Number(d.amount)||0)-(d.paid?Number(d.amount)||0:Number(d.reserved)||0))}
function renderDebts(){
  const root=$('#debtList');if(!root)return;const items=[...state.debts].sort((a,b)=>(a.paid-b.paid)||String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999')));root.innerHTML='';
  const remaining=items.reduce((s,d)=>s+debtRemaining(d),0);$('#debtListTotal').textContent=`Осталось ${money(remaining)}`;
  if(!items.length){root.innerHTML='<div class="empty">Долгов пока нет. Редкий и подозрительно приятный экран.</div>';return}
  items.forEach(d=>{const item=document.createElement('article');item.className='debt-item'+(d.paid?' paid':'');const reserved=d.paid?d.amount:Math.min(d.amount,d.reserved||0);const pct=d.amount?Math.min(100,reserved/d.amount*100):0;
    item.innerHTML=`<div class="debt-head"><strong>${escapeHtml(d.title)}</strong><strong>${money(d.amount)}</strong></div><div class="debt-meta">${escapeHtml(d.categoryName||'Удалённая категория')}${d.dueDate?' · до '+formatDate(d.dueDate):''}${d.paid?' · оплачено':''}</div>${d.comment?`<div class="debt-meta">${escapeHtml(d.comment)}</div>`:''}<div class="debt-progress"><span style="width:${pct}%"></span></div><div class="debt-progress-label"><span class="muted-inline">Отложено: ${money(reserved)}</span><strong>Осталось: ${money(debtRemaining(d))}</strong></div>`;
    const actions=document.createElement('div');actions.className='debt-actions';const input=document.createElement('input');input.type='number';input.min='0';input.max=String(d.amount);input.step='0.01';input.value=String(reserved);input.disabled=d.paid;input.title='Отложенная сумма';input.addEventListener('change',()=>{d.reserved=Math.min(d.amount,Math.max(0,Number(input.value)||0));d.paid=d.reserved>=d.amount;saveState();renderAll()});
    const edit=miniButton('Редактировать',()=>editDebt(d));const paid=miniButton(d.paid?'Вернуть в неоплаченные':'Отметить оплаченным',()=>{d.paid=!d.paid;d.reserved=d.paid?d.amount:Math.min(d.reserved||0,d.amount);saveState();renderAll()});const del=miniButton('Удалить',()=>{if(confirm('Удалить этот долг?')){state.debts=state.debts.filter(x=>x.id!==d.id);saveState();renderAll()}},true);actions.append(input,edit,paid,del);item.append(actions);root.append(item)
  })
}
function dateDiffDays(fromDate,toDate){
  const from=new Date(fromDate+'T00:00:00');const to=new Date(toDate+'T00:00:00');
  return Math.round((to-from)/86400000);
}
function dueDayLabel(days){
  if(days===0)return 'Сегодня';if(days===1)return 'Завтра';return `Через ${days} дня`;
}
function renderUpcomingDebtAlert(debts){
  const alertBox=$('#upcomingDebtAlert');const list=$('#upcomingDebtList');const summary=$('#upcomingDebtSummary');
  if(!alertBox||!list||!summary)return;
  const today=localDate();
  const upcoming=debts.filter(d=>!d.paid&&d.dueDate&&debtRemaining(d)>0).map(d=>({...d,daysUntil:dateDiffDays(today,d.dueDate)})).filter(d=>d.daysUntil>=0&&d.daysUntil<=3).sort((a,b)=>a.daysUntil-b.daysUntil||String(a.dueDate).localeCompare(String(b.dueDate)));
  list.innerHTML='';alertBox.classList.toggle('hidden',!upcoming.length);
  if(!upcoming.length){summary.textContent='';return}
  const total=upcoming.reduce((s,d)=>s+debtRemaining(d),0);summary.textContent=`${upcoming.length} платеж${upcoming.length===1?'':upcoming.length<5?'а':'ей'} · осталось ${money(total)}`;
  upcoming.forEach(d=>{const row=document.createElement('div');row.className='upcoming-debt-row';row.innerHTML=`<div><strong>${escapeHtml(d.title)}</strong><span>${escapeHtml(d.categoryName||'Удалённая категория')} · ${dueDayLabel(d.daysUntil)}, ${formatDate(d.dueDate)}</span></div><strong>${money(debtRemaining(d))}</strong>`;list.append(row)});
}
function renderDebtDashboard(){
  const selected=new Set(state.debtCategories.filter(c=>c.showOnDashboard).map(c=>c.id));const debts=state.debts.filter(d=>selected.has(d.categoryId));const total=debts.reduce((s,d)=>s+(Number(d.amount)||0),0);const reserved=debts.reduce((s,d)=>s+(d.paid?Number(d.amount)||0:Math.min(Number(d.amount)||0,Number(d.reserved)||0)),0);const remaining=Math.max(0,total-reserved);
  renderUpcomingDebtAlert(debts);
  $('#metricDebtTotal').textContent=money(total);$('#metricDebtReserved').textContent=money(reserved);$('#metricDebtRemaining').textContent=money(remaining);const root=$('#dashboardDebtBreakdown');root.innerHTML='';
  const groups=new Map();debts.forEach(d=>{const k=d.categoryName||'Удалённая категория';groups.set(k,(groups.get(k)||0)+debtRemaining(d))});if(!groups.size){root.innerHTML='<p class="muted">Выберите категории долгов в настройках или добавьте записи.</p>';return}[...groups].sort((a,b)=>b[1]-a[1]).forEach(([name,value])=>{const row=document.createElement('div');row.className='debt-breakdown-row';row.innerHTML=`<span>${escapeHtml(name)}</span><strong>${money(value)}</strong>`;root.append(row)})
}

function addDebtCategory(){
  if(!Array.isArray(state.debtCategories))state.debtCategories=[];
  const existingNumbers=state.debtCategories.map(c=>{const m=String(c.name||'').match(/Категория долга\s+(\d+)/i);return m?Number(m[1]):0});
  const next=Math.max(state.debtCategories.length,...existingNumbers)+1;
  const category={id:uid(),name:`Категория долга ${next}`,showOnDashboard:false};
  state.debtCategories.push(category);
  saveState();
  refreshSelectors();
  renderCategoryEditors();
  renderDashboard();
  requestAnimationFrame(()=>{const editor=$('#debtCategoryEditor');const input=editor?.querySelector('.category-row:last-child input');if(input){input.focus();input.select();input.scrollIntoView({behavior:'smooth',block:'center'})}});
}

function renderDebtCategoryEditor(){
  const root=$('#debtCategoryEditor');if(!root)return;root.innerHTML='';state.debtCategories.forEach(cat=>{
    const row=document.createElement('div');row.className='debt-category-card';
    const input=document.createElement('input');input.className='debt-category-name';input.value=cat.name;input.addEventListener('change',()=>{const old=cat.name;cat.name=input.value.trim()||cat.name;state.debts.filter(d=>d.categoryId===cat.id&&d.categoryName===old).forEach(d=>d.categoryName=cat.name);saveState();refreshSelectors();renderAll()});
    const toggles=document.createElement('div');toggles.className='debt-category-toggles';
    const dashboardLabel=document.createElement('label');dashboardLabel.className='toggle-card compact';const dashboardCheck=document.createElement('input');dashboardCheck.type='checkbox';dashboardCheck.checked=cat.showOnDashboard;dashboardCheck.addEventListener('change',()=>{cat.showOnDashboard=dashboardCheck.checked;saveState();renderDashboard()});dashboardLabel.append(dashboardCheck,makeToggleText('Показывать на дашборде','Учитывать эту категорию в итогах'));
    toggles.append(dashboardLabel);row.append(input,toggles,miniButton('Удалить',()=>deleteDebtCategory(cat),true));root.append(row)
  })
}
function makeToggleText(title,subtitle){const span=document.createElement('span');const strong=document.createElement('strong');strong.textContent=title;const small=document.createElement('small');small.textContent=subtitle;span.append(strong,small);return span}
function deleteDebtCategory(cat){if(!confirm(`Удалить категорию долга «${cat.name}»? Старые записи сохранят её название.`))return;state.debtCategories=state.debtCategories.filter(c=>c.id!==cat.id);saveState();refreshSelectors();renderAll()}

init();
