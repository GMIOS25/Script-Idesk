import { appendLog } from './logger.js';

// Cac tu khoa trong ten file cho biet day la ban da ky/da dong dau chinh thuc
const SEALED_KEYWORDS = ['dadongdau', 'daky'];

const normalizeText = (str) =>
    (str || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // bo dau tieng Viet
        .toLowerCase()
        .replace(/[\s\-_]/g, '');

// Trich so hieu van ban theo pattern ro rang (CV-<so>, So <so>...) thay vi
// lay bua chuoi so dau tien gap trong chuoi. Chuan hoa bo so 0 dau de so
// sanh linh hoat ("339" === "0339").
const extractDocNumber = (str) => {
    if (!str) return null;
    const patterns = [
        /CV[-_\s]?0*(\d+)/i,
        /S[ôoố][^\d]{0,3}0*(\d+)/i,
    ];
    for (const p of patterns) {
        const m = str.match(p);
        if (m) return parseInt(m[1], 10).toString();
    }
    // fallback: so dung sau dau gach/space (tranh bat nham so dinh lien chu nhu "A21")
    const m2 = str.match(/[-_\s](\d+)/);
    return m2 ? parseInt(m2[1], 10).toString() : null;
};

const isPdf = (att) => att.format === 'pdf' || (att.name || '').toLowerCase().endsWith('.pdf');
const isSigned = (att) => att.signed === 'Y';

export const selectAttachment = (doc) => {
    const attachments = doc.attachments || [];
    if (attachments.length === 0) return null;

    // Buoc 1: chi xet file PDF + da ky lam ung vien "file chinh". Noi dan
    // dieu kien neu nhom rong - file .doc/.docx chi duoc chon khi khong
    // con lua chon nao khac. Dieu nay tranh viec mot ban thao chua ky bi
    // chon nham chi vi trung so trong ten file.
    let candidates = attachments.filter(att => isPdf(att) && isSigned(att));
    let stage = 'pdf+signed';
    if (candidates.length === 0) { candidates = attachments.filter(isSigned); stage = 'signed'; }
    if (candidates.length === 0) { candidates = attachments.filter(isPdf); stage = 'pdf'; }
    if (candidates.length === 0) { candidates = attachments; stage = 'all'; }

    if (candidates.length === 1) {
        appendLog(`Chi co 1 ung vien hop le (${stage}): ${candidates[0].name}`);
        return candidates[0];
    }

    // Buoc 2: uu tien file co dau hieu da dong dau trong ten - day la ban
    // phat hanh cuoi cung, co gia tri phap ly cao nhat.
    const sealedMatch = candidates.find(att =>
        SEALED_KEYWORDS.some(kw => normalizeText(att.name).includes(kw))
    );
    if (sealedMatch) {
        appendLog(`Match file dinh kem theo tu khoa da dong dau: ${sealedMatch.name}`);
        return sealedMatch;
    }

    // Buoc 3: match theo so hieu van ban (signNumber), da chuan hoa so 0 dau
    const signDigits = extractDocNumber(doc.signNumber || '');
    if (signDigits) {
        const matchedByNum = candidates.find(att => extractDocNumber(att.name) === signDigits);
        if (matchedByNum) {
            appendLog(`Match file dinh kem theo so hieu "${signDigits}": ${matchedByNum.name}`);
            return matchedByNum;
        }
    }

    // Buoc 4: fallback - file co kich thuoc lon nhat trong nhom ung vien
    // (ban da dong dau/scan thuong nang hon ban thao do co anh chu ky/con dau)
    const bySize = [...candidates].sort((a, b) => (b.size || 0) - (a.size || 0))[0];
    const fallback = bySize || candidates[0];
    appendLog(`Fallback chon file lon nhat trong nhom hop le (${stage}): ${fallback ? fallback.name : 'N/A'}`);
    return fallback;
};
