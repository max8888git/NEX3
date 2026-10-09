function sem(s, sl) {
  return { semester: String(s), semesterLabel: sl };
}
function rows(prefix, course, dept, yearStarts, subs, units) {
  const u = units || 3;
  const out = [];
  let i = 0;
  for (let y = 0; y < 4; y++) {
    const base = yearStarts[y];
    for (let k = 0; k < 4; k++) {
      const num = base + k;
      const code = prefix + ' ' + num;
      const s = k < 2 ? 1 : 2;
      const sl = k < 2 ? '1st' : '2nd';
      out.push({
        dept,
        course,
        schoolYear: '2025-2026',
        ...sem(s, sl),
        status: 'active',
        section: 'A',
        units: u,
        classCode: code,
        subject: subs[i++],
        time: 'MWF 8:00–10:00 AM',
        building: 'lrc',
      });
    }
  }
  return out;
}
function fmt(arr) {
  return arr
    .map(function (r) {
      return (
        "      { dept: '" +
        r.dept +
        "', course: '" +
        r.course +
        "', schoolYear: '" +
        r.schoolYear +
        "', semester: '" +
        r.semester +
        "', semesterLabel: '" +
        r.semesterLabel +
        "', status: '" +
        r.status +
        "', section: '" +
        r.section +
        "', units: " +
        r.units +
        ", classCode: '" +
        r.classCode +
        "', subject: '" +
        r.subject.replace(/'/g, "\\'") +
        "', time: '" +
        r.time +
        "', building: '" +
        r.building +
        "' },"
      );
    })
    .join('\n');
}
const csSubs = [
  'Introduction to Computing',
  'Computer Programming 1',
  'Discrete Structures',
  'Computer Organization',
  'Data Structures',
  'OOP',
  'Database Systems',
  'Networks',
  'Algorithms',
  'Software Engineering',
  'Operating Systems',
  'Automata',
  'Capstone Project I',
  'Capstone Project II',
  'Practicum',
  'Senior Seminar',
];
const itSubs = [
  'Introduction to Information Technology',
  'Computer Systems Fundamentals',
  'Web Technologies',
  'IT Ethics and Professional Practice',
  'Systems Analysis and Design',
  'Database Systems',
  'Networking Essentials',
  'Web Applications',
  'Information Security',
  'Cloud Computing',
  'Data Analytics',
  'Project Management',
  'IT Capstone I',
  'IT Capstone II',
  'IT Practicum',
  'Emerging Technologies',
];
const emcSubs = [
  'Media and Society',
  'Visual Literacy',
  'Writing for Media',
  'Media Law',
  'Digital Storytelling',
  'Video Production',
  'Audio Production',
  'Media Research',
  'Documentary Production',
  'Broadcast Journalism',
  'Integrated Campaigns',
  'PR Writing',
  'EMC Capstone I',
  'EMC Capstone II',
  'Portfolio Development',
  'Media Internship',
];
const psySubs = [
  'General Psychology',
  'Developmental Psychology',
  'Social Foundations',
  'Psychological Statistics',
  'Social Psychology',
  'Cognitive Psychology',
  'Abnormal Psychology',
  'Research Methods',
  'Theories of Personality',
  'Industrial Psychology',
  'Experimental Psychology',
  'Psychological Assessment',
  'Psych Capstone I',
  'Psych Capstone II',
  'Clinical Practicum',
  'Psychology Seminar',
];
const optSubs = [
  'Introduction to Optometry',
  'Geometric Optics',
  'Ocular Anatomy',
  'Visual Science',
  'Clinical Optometry I',
  'Physiological Optics',
  'Ocular Disease',
  'Contact Lenses',
  'Pediatric Optometry',
  'Low Vision',
  'Binocular Vision',
  'Advanced Clinical Skills',
  'Optometry Capstone I',
  'Optometry Capstone II',
  'Clinical Internship',
  'Community Eye Care',
];
const denSubs = [
  'Dental Anatomy',
  'Oral Histology',
  'Dental Materials',
  'Oral Biology',
  'Oral Pathology',
  'Pharmacology',
  'Radiology',
  'Periodontics',
  'Endodontics',
  'Operative Dentistry',
  'Prosthodontics',
  'Oral Surgery',
  'Dentistry Capstone I',
  'Dentistry Capstone II',
  'Clinical Dentistry',
  'Comprehensive Care',
];
const ptSubs = [
  'Introduction to Physical Therapy',
  'Kinesiology',
  'Anatomy for PT',
  'Physiology for PT',
  'Therapeutic Exercise',
  'Manual Therapy',
  'Neurology',
  'Cardiopulmonary PT',
  'Sports PT',
  'Pediatric PT',
  'Geriatric PT',
  'Electrotherapy',
  'PT Capstone I',
  'PT Capstone II',
  'Clinical Internship I',
  'Clinical Internship II',
];
const phaSubs = [
  'Pharmaceutical Chemistry',
  'Pharmacology I',
  'Pharmaceutics',
  'Pharmaceutical Calculations',
  'Pharmacology II',
  'Medicinal Chemistry',
  'Pharmacotherapy',
  'Pharmacy Law',
  'Clinical Pharmacy I',
  'Clinical Pharmacy II',
  'Pharmacy Management',
  'Pharmacokinetics',
  'Pharmacy Capstone I',
  'Pharmacy Capstone II',
  'Advanced Practice',
  'Introductory Pharmacy Practice',
];
const all = []
  .concat(rows('CS', 'cs', 'col-as', [101, 201, 301, 401], csSubs))
  .concat(rows('IT', 'it', 'col-as', [101, 201, 301, 401], itSubs))
  .concat(rows('EMC', 'emc', 'col-as', [101, 201, 301, 401], emcSubs))
  .concat(rows('PSY', 'psych', 'col-as', [101, 201, 301, 401], psySubs))
  .concat(rows('OPT', 'opt-od', 'col-opt', [101, 201, 301, 401], optSubs, 4))
  .concat(rows('DEN', 'dent-dmd', 'col-dent', [101, 201, 301, 401], denSubs, 4))
  .concat(rows('PT', 'pt-dpt', 'col-pt', [101, 201, 301, 401], ptSubs, 4))
  .concat(rows('PHA', 'pharm-pharmd', 'col-pharm', [101, 201, 301, 401], phaSubs, 3));
console.log(fmt(all));
