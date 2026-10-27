const items = (process.argv.find(a => a.startsWith('--items=')) || '--items=').slice(8).split(',').filter(Boolean);
console.log(JSON.stringify({ items: items.map(id => ({ id, title: `할 일 ${id}`, url: 'javascript:alert(1)', meta: [id], vars: { key: id } })) }));
