document.addEventListener('click', (e) => {
  const abrir = e.target.closest('[data-abrir]')
  if (abrir) { const m = abrir.closest('.medio'); const ya = m.classList.contains('abierto'); document.querySelectorAll('.medio').forEach((x) => x.classList.remove('abierto')); if (!ya) m.classList.add('abierto'); return }
  const copiar = e.target.closest('[data-copiar]')
  if (copiar) {
    const listo = () => { copiar.textContent = '✓ Copiado'; copiar.classList.add('ok'); setTimeout(() => { copiar.textContent = 'Copiar'; copiar.classList.remove('ok') }, 1800) }
    if (navigator.clipboard) navigator.clipboard.writeText(copiar.dataset.copiar).then(listo, listo); else listo()
    return
  }
  const demo = e.target.closest('[data-demo]')
  if (demo) { e.preventDefault(); alert('Vista previa: en la versión real este botón abre Mercado Pago o WhatsApp.') }
})
