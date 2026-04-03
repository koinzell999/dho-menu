const tabs = document.querySelectorAll('.tab-btn');
const sections = document.querySelectorAll('.section');

tabs.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.category;

    // Update active tab
    tabs.forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');

    // Show/hide sections
    sections.forEach(sec => {
      if (target === 'all' || sec.dataset.category === target) {
        sec.classList.remove('hidden');
        sec.setAttribute('aria-hidden', 'false');
      } else {
        sec.classList.add('hidden');
        sec.setAttribute('aria-hidden', 'true');
      }
    });
  });
});
