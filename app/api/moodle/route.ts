import { NextResponse } from 'next/server';
import { runtimeEnv } from '../../../db/runtime';
import { getStudentFeedback } from '@/lib/feedback-store';

export async function GET(request: Request) {
  const { MOODLE_URL, MOODLE_TOKEN } = runtimeEnv();
  const authorization = request.headers.get('authorization');
  const clientToken = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const moodleToken = clientToken || MOODLE_TOKEN;
  if (!MOODLE_URL || !moodleToken) {
    return NextResponse.json({
      mode: 'demo',
      courses: [],
      deadlines: [],
      resources: [],
      examResults: [],
      latestResult: null,
      syncedAt: new Date().toISOString(),
      message: 'Đăng nhập Moodle để tải các khóa học của bạn.',
    });
  }
  const base = `${MOODLE_URL.replace(/\/$/,'')}/webservice/rest/server.php`;
  const call = async <T>(fn:string, extra:Record<string,string>={}) => {
    const params=new URLSearchParams({wstoken:moodleToken,wsfunction:fn,moodlewsrestformat:'json',...extra});
    const response=await fetch(`${base}?${params}`,{headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error(`Moodle ${response.status}`);
    const data=await response.json() as T & {exception?:string;message?:string};
    if(data&&typeof data==='object'&&'exception' in data)throw new Error(data.message??'Moodle API error');
    return data;
  };
  try {
    const site=await call<{userid:number;fullname:string;username?:string;userpictureurl?:string;userissiteadmin?:boolean}>('core_webservice_get_site_info');
    const courses=await call<Array<{id:number;shortname:string;fullname:string;progress?:number}>>('core_enrol_get_users_courses',{userid:String(site.userid)});
    const [upcoming, gradeResults, courseEnrolledUsers, ...contents] = await Promise.all([
      call<{events?:Array<{id:number;name:string;timestart:number;url?:string;course?:{fullname?:string}}>}>('core_calendar_get_calendar_upcoming_view'),
      Promise.allSettled(
        courses.slice(0, 20).map(course =>
          call<{
            usergrades?: Array<{
              courseid: number;
              courseidnumber?: string;
              userid: number;
              userfullname?: string;
              gradeitems: Array<{
                id: number;
                itemname: string | null;
                itemtype: string;
                itemmodule: string | null;
                iteminstance?: number | null;
                cmid?: number | null;
                graderaw?: number | null;
                grademin?: number;
                grademax?: number;
                gradepass?: number;
                gradeformatted?: string;
                percentageformatted?: string;
                gradedategraded?: number | null;
                gradedatesubmitted?: number | null;
                feedback?: string;
              }>;
            }>;
          }>('gradereport_user_get_grade_items', {
            courseid: String(course.id),
            userid: String(site.userid),
          })
        )
      ),
      Promise.allSettled(
        courses.slice(0, 20).map(course =>
          call<Array<{ id: number; roles?: Array<{ roleid: number; shortname: string }> }>>('core_enrol_get_enrolled_users', {
            courseid: String(course.id),
          })
        )
      ),
      ...courses.slice(0,20).map(course=>call<Array<{modules?:Array<{id:number;name:string;modname:string;contents?:Array<{filename:string;fileurl:string}>}>}>>('core_course_get_contents',{courseid:String(course.id)}).catch(()=>[])),
    ]);
    const excludedMods = new Set(['forum', 'quiz', 'assign', 'assignment', 'feedback', 'survey', 'choice', 'chat', 'attendance']);
    const allowedExtensions = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt']);

    const resources = contents.flatMap((sections, index) =>
      sections.flatMap(section =>
        (section.modules ?? []).flatMap(module => {
          const modType = (module.modname || '').toLowerCase();
          if (excludedMods.has(modType)) return [];

          const files = (module.contents ?? [])
            .filter(file => {
              const ext = file.filename.split('.').pop()?.toLowerCase() || '';
              return allowedExtensions.has(ext);
            })
            .map(file => ({
              courseId: courses[index]?.id,
              courseCode: courses[index]?.shortname,
              courseName: courses[index]?.fullname,
              module: module.name,
              type: file.filename.split('.').pop()?.toUpperCase() || 'FILE',
              name: file.filename,
              url: file.fileurl ? `${file.fileurl}${file.fileurl.includes('?') ? '&' : '?'}token=${encodeURIComponent(moodleToken)}` : '',
            }));

          if (files.length > 0) return files;

          // If it is a web link / URL resource
          if (modType === 'url' || modType === 'page') {
            const directUrl = module.contents?.[0]?.fileurl || '';
            const fallbackUrl = `${MOODLE_URL.replace(/\/$/, '')}/mod/${module.modname}/view.php?id=${module.id}`;
            return [
              {
                courseId: courses[index]?.id,
                courseCode: courses[index]?.shortname,
                courseName: courses[index]?.fullname,
                module: module.name,
                type: 'LINK',
                name: module.name,
                url: directUrl || fallbackUrl,
              },
            ];
          }

          return [];
        })
      )
    );

    const now = Date.now();
    const deadlines = (upcoming.events ?? [])
      .filter(event => (event.timestart * 1000) > now)
      .map(event => ({
        id: event.id,
        name: event.name,
        courseName: event.course?.fullname ?? 'Moodle',
        timestamp: event.timestart * 1000,
        url: event.url,
      }));
    const avatarUrl = moodleToken
      ? `/api/moodle/avatar?token=${encodeURIComponent(moodleToken)}&v=${site.userid}`
      : site.userpictureurl || null;

    const examResults: Array<{
      id: number;
      courseId: number;
      courseName: string;
      courseCode: string;
      name: string;
      itemModule: string;
      score: number;
      maxScore: number;
      minScore: number;
      percentage: string;
      gradedAt: number;
      feedback: string;
      passed: boolean;
      url: string;
    }> = [];

    gradeResults.forEach((res, idx) => {
      if (res.status !== 'fulfilled' || !res.value?.usergrades) return;
      const course = courses[idx];
      if (!course) return;

      for (const ug of res.value.usergrades) {
        for (const item of ug.gradeitems || []) {
          if (
            item.itemtype === 'course' ||
            !item.itemname ||
            item.itemname.trim() === '' ||
            item.graderaw === null ||
            item.graderaw === undefined
          ) {
            continue;
          }

          const rawScore = Number(item.graderaw);
          if (isNaN(rawScore)) continue;

          let maxScore = Number(item.grademax ?? 10);
          const minScore = Number(item.grademin ?? 0);
          // If grade is on standard 10-point scale but Moodle grademax was left at 100
          if (maxScore === 100 && rawScore <= 10) {
            maxScore = 10;
          }

          const passGrade = item.gradepass && item.gradepass > 0 ? item.gradepass : (maxScore / 2);
          const passed = rawScore >= passGrade;

          let percentage = '';
          if (maxScore > 0) {
            percentage = `${Math.round((rawScore / maxScore) * 100)}%`;
          }

          const timestamp = (item.gradedategraded || item.gradedatesubmitted || 0) * 1000;
          const url = item.cmid
            ? `${MOODLE_URL.replace(/\/$/, '')}/mod/${item.itemmodule || 'quiz'}/view.php?id=${item.cmid}`
            : `${MOODLE_URL.replace(/\/$/, '')}/course/view.php?id=${course.id}`;

          let feedback = item.feedback?.replace(/<[^>]*>/g, '').trim() || '';
          if (!feedback) {
            const stored =
              getStudentFeedback(site.userid, course.id, item.itemname) ||
              (site.username ? getStudentFeedback(site.username, course.id, item.itemname) : null);
            if (stored && stored.feedback) {
              feedback = stored.feedback.trim();
            }
          }

          examResults.push({
            id: item.id,
            courseId: course.id,
            courseName: course.fullname,
            courseCode: course.shortname,
            name: item.itemname,
            itemModule: item.itemmodule || 'manual',
            score: rawScore,
            maxScore,
            minScore,
            percentage,
            gradedAt: timestamp || Date.now(),
            feedback,
            passed,
            url,
          });
        }
      }
    });

    examResults.sort((a, b) => (b.gradedAt || 0) - (a.gradedAt || 0));
    const latestResult = examResults[0] || null;

    const mappedCourses = courses.map((course, idx) => {
      let role = 'student';
      let isTeacher = false;
      const enrolledRes = courseEnrolledUsers[idx];
      if (enrolledRes && enrolledRes.status === 'fulfilled' && Array.isArray(enrolledRes.value)) {
        const me = enrolledRes.value.find(u => u.id === site.userid);
        if (me?.roles && me.roles.length > 0) {
          const teacherRole = me.roles.find(r =>
            ['editingteacher', 'teacher'].includes(r.shortname)
          );
          if (teacherRole) {
            isTeacher = true;
            role = teacherRole.shortname;
          } else if (me.roles.some(r => ['manager', 'coursecreator', 'admin'].includes(r.shortname)) || Boolean(site.userissiteadmin)) {
            isTeacher = true;
            role = 'editingteacher';
          } else {
            role = 'student';
            isTeacher = false;
          }
        } else if (site.userissiteadmin) {
          isTeacher = true;
          role = 'editingteacher';
        }
      } else if (site.userissiteadmin) {
        isTeacher = true;
        role = 'editingteacher';
      }
      return {
        ...course,
        role,
        isTeacher,
      };
    });

    return NextResponse.json({
      mode: 'live',
      user: {
        id: site.userid,
        name: site.fullname,
        username: site.username,
        avatarUrl,
      },
      courses: mappedCourses,
      deadlines,
      resources,
      examResults,
      latestResult,
      syncedAt: new Date().toISOString(),
      moodleUrl: MOODLE_URL ? MOODLE_URL.replace(/\/$/, '') : 'http://moodle.test',
    });
  } catch (error) {
    return NextResponse.json({error:error instanceof Error?error.message:'Không thể đồng bộ Moodle.'},{status:502});
  }
}
