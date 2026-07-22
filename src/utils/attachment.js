import { appendLog } from './logger.js';

export const selectAttachment = (doc) => {
    const attachments = doc.attachments || [];
    if (attachments.length === 0) return null;

    const signNumber = doc.signNumber || '';
    const leadingMatch = signNumber.match(/^\s*(\d+)/) || signNumber.match(/(\d+)/);
    const signDigits = leadingMatch ? leadingMatch[1] : null;

    if (signDigits) {
        const matchedByNum = attachments.find(att => {
            const name = att.name || '';
            const attDigitsMatch = name.match(/^\s*(\d+)/) || name.match(/(\d+)/);
            return attDigitsMatch && attDigitsMatch[1] === signDigits;
        });
        if (matchedByNum) {
            appendLog(`Match file dinh kem theo so dau "${signDigits}": ${matchedByNum.name}`);
            return matchedByNum;
        }
    }

    const matchedSigned = attachments.find(att => att.signed === 'Y');
    if (matchedSigned) {
        appendLog(`Fallback chon file da ky (signed="Y"): ${matchedSigned.name}`);
        return matchedSigned;
    }

    const pdfAttach = attachments.find(att => att.format === 'pdf' || (att.name || '').toLowerCase().endsWith('.pdf'));
    const fallback = pdfAttach || attachments[0];
    appendLog(`Fallback mac dinh chon file: ${fallback ? fallback.name : 'N/A'}`);
    return fallback;
};
