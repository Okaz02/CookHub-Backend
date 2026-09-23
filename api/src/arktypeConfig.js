const { configure } = require('arktype/config');

const typeNames = {
    string: '文字列',
    number: '数値',
    boolean: '真偽値',
    object: 'オブジェクト'
};

configure({
    // フォーク・更新は DB 行に入力を重ねて検証するので、入力ではない列を落とす
    onUndeclaredKey: 'delete',

    keywords: typeNames,

    predicate: { problem: (error) => `${error.expected}で指定してください` },

    required: { problem: () => '必須です' },
    domain: { problem: (error) => `${error.expected}で指定してください` },
    pattern: { problem: (error) => `${error.expected}の形式で指定してください` },
    // 1文字以上は「空でない」の意味なので必須として伝える
    minLength: { problem: (error) => (error.rule <= 1 ? '必須です' : `${error.rule}文字以上で指定してください`) },
    maxLength: { problem: (error) => `${error.rule}文字以内で指定してください` },
    min: { problem: (error) => `${error.rule}${error.exclusive ? 'より大きい' : '以上の'}数値で指定してください` },
    max: { problem: (error) => `${error.rule}${error.exclusive ? 'より小さい' : '以下の'}数値で指定してください` },
    divisor: { problem: (error) => (error.rule === 1 ? '整数で指定してください' : `${error.rule}の倍数で指定してください`) }
});
