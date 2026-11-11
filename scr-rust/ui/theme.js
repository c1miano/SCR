try {
  document.documentElement.dataset.theme =
    localStorage.getItem('semestre-theme') === 'dark' ? 'dark' : 'light';
} catch {
  document.documentElement.dataset.theme = 'light';
}
