function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

function isDuplicateEntry(error) {
    return error.code === 'ER_DUP_ENTRY' || error.errno === 1062;
}

module.exports = { httpError, isDuplicateEntry };
