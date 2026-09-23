require('./src/config');
const { type } = require('arktype');
const { recipeSchema } = require('./src/schemas/recipeSchemas');
const show = (l, o) => console.log(l, JSON.stringify(o?.summary ?? o));

for (const v of [true, false, 1, 0, 'true', 'false', null, undefined]) {
  try {
    show(`is_private=${JSON.stringify(v)} ->`, recipeSchema({ title: 'a', is_private: v }));
  } catch (e) { console.log(`is_private=${JSON.stringify(v)} -> THROW`, e.message); }
}
console.log('--- flag() alone ---');
try {
  const flag = type('boolean').configure({ problem: () => '真偽値で指定してください' }, 'union').default(false);
  console.log('built ok', JSON.stringify(flag('x')?.summary ?? flag('x')));
} catch (e) { console.log('THROW', e.message); }
