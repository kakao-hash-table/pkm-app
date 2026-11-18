const ids = (process.env.LIST_ITEMS ?? 'A-1').split(',').filter(Boolean);
console.log(JSON.stringify({ items: ids.map(id => ({ id, title: `할 일 ${id}` })) }));
