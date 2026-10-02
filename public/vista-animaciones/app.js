
const fmt=(n,d)=>n.toLocaleString('es-AR',{minimumFractionDigits:d,maximumFractionDigits:d});
function contar(){document.querySelectorAll('.cuenta').forEach(el=>{const fin=+el.dataset.fin,dec=+(el.dataset.dec||0),t0=performance.now(),dur=1200;
  const paso=t=>{const p=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-p,3);el.textContent=fmt(fin*e,dec);if(p<1)requestAnimationFrame(paso)};requestAnimationFrame(paso)})}
function llenar(){document.getElementById('dona').style.strokeDashoffset=201*(1-.65);document.getElementById('barra').style.width='65%'}
function repetir(){const app=document.getElementById('app');app.classList.remove('animando');document.getElementById('dona').style.strokeDashoffset=201;document.getElementById('barra').style.width='0';
  void app.offsetWidth;app.classList.add('animando');setTimeout(()=>{contar();llenar()},250)}
let tt;function toast(){const t=document.getElementById('toast');t.classList.remove('ver');void t.offsetWidth;t.classList.add('ver');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('ver'),2200)}
window.addEventListener('load',repetir)

document.addEventListener('click',e=>{const b=e.target.closest('[data-accion]');if(!b)return;if(b.dataset.accion==='repetir')repetir();else toast()});
