// Identity links do not merge database records or import application roles.
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const enabled = user => Boolean(user?.active && !user.deletedAt);

function prepareLinks(attendanceUsers, crmUsers, explicitPairs = []) {
  const index = users => {
    const rows = new Map();
    for (const user of users) {
      const email = normalizeEmail(user.email);
      if (!email) continue;
      if (!rows.has(email)) rows.set(email, []);
      rows.get(email).push(user);
    }
    return rows;
  };
  const left = index(attendanceUsers), right = index(crmUsers);
  const pairs = [], blocked = [], seenLocal = new Set(), seenRemote = new Set();
  function add(a, c, method) {
    if (!enabled(a) || !enabled(c) || c.role === 'REPRESENTANTE' || a.role === 'BOT') {
      blocked.push({ attendanceId: a.id, crmId: c.id, reason: 'INACTIVE_OR_EXCLUDED_ROLE' });
      return;
    }
    if (seenLocal.has(a.id) || seenRemote.has(c.id)) throw Error('An account cannot be linked twice');
    seenLocal.add(a.id); seenRemote.add(c.id);
    pairs.push({ attendanceId: a.id, crmId: c.id, primaryEmail: normalizeEmail(a.email),
      attendanceRole: a.role, crmRole: c.role, method, credentialAuthority: 'ATTENDANCE' });
  }
  for (const [email, users] of left) {
    const others = right.get(email);
    if (!others) continue;
    if (users.length !== 1 || others.length !== 1) { blocked.push({ email, reason: 'AMBIGUOUS_EMAIL' }); continue; }
    add(users[0], others[0], 'UNIQUE_EMAIL');
  }
  for (const pair of explicitPairs) {
    const a = attendanceUsers.find(u => u.id === pair.attendanceId);
    const c = crmUsers.find(u => u.id === pair.crmId);
    if (!a || !c || pair.approved !== true) throw Error('Explicit link requires confirmed identities');
    add(a, c, 'OWNER_CONFIRMED');
  }
  // Representatives and CRM-only users retain their existing authentication.
  return { pairs, blocked, unchangedCrmIds: crmUsers.filter(u => !seenRemote.has(u.id)).map(u => u.id) };
}

function crmCredentialPolicy(user, link) {
  if (!enabled(user)) return 'DENY';
  if (user.role === 'REPRESENTANTE') return 'CRM_LOCAL';
  return link?.enabled ? 'ATTENDANCE_PRIMARY' : 'CRM_LOCAL';
}

function canEnterAttendance(user, link) {
  return enabled(user) && user.role !== 'REPRESENTANTE' && Boolean(link?.enabled && link.attendanceId);
}

module.exports = { normalizeEmail, prepareLinks, crmCredentialPolicy, canEnterAttendance };
