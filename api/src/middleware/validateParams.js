const { ArkErrors } = require('arktype');

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
