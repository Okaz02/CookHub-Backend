// パスパラメータをスキーマで検証し、req.params を検証後の値（:id なら数値）に差し替える。
// 検証に落ちたエラーは app.js のエラーハンドラが 400 に変換する
function validateParams(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.params);
        if (!result.success) {
            next(result.error);
            return;
        }

        req.params = result.data;
        next();
    };
}

module.exports = validateParams;
