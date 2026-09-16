// 指定した req.params が数値でなければ 400 を返す
function validateNumericParams(...paramNames) {
    return (req, res, next) => {
        for (const name of paramNames) {
            if (!/^\d+$/.test(req.params[name])) {
                const err = new Error(`${name} は数値で指定してください`);
                err.status = 400;
                next(err);
                return;
            }
        }
        next();
    };
}

module.exports = validateNumericParams;
