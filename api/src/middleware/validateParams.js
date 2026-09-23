const { ArkErrors } = require('arktype');

// 検証に落ちたエラーは app.js のエラーハンドラが 400 に変換する
function validateParams(schema) {
    return (req, res, next) => {
        const params = schema(req.params);
        if (params instanceof ArkErrors) {
            next(params);
            return;
        }

        req.params = params;
        next();
    };
}

module.exports = validateParams;
