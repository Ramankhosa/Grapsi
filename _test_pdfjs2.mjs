const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
console.log('default export:', typeof mod.default);
console.log('getDocument:', typeof mod.getDocument);
console.log('GlobalWorkerOptions:', typeof mod.GlobalWorkerOptions);
console.log('Has default?', 'default' in mod);
console.log('Module keys (first 20):', Object.keys(mod).slice(0, 20));

// Try the .then() pattern used in the service
const mod2 = await import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
  console.log('\n.then() mod keys:', Object.keys(m).slice(0, 5));
  console.log('.then() GlobalWorkerOptions:', typeof m.GlobalWorkerOptions);
  return m;
});
console.log('mod2 getDocument:', typeof mod2.getDocument);
