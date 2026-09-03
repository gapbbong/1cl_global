import { supabase, supabaseRealtime } from './supabase.js';
import { getTeacherProfile, getCurrentTeacherEmail } from './api.js';

let cachedTeacherProfile = null; // 프로필 데이터 캐싱을 통해 DB 부하 감소

/**
 * 인앱 토스트 알림 표시 (Native 알림이 Supressed되는 포그라운드 상황 대비)
 */
function showInAppToast(message) {
  // 기존 토스트가 있으면 제거
  const existing = document.querySelector('.notification-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'notification-toast';
  toast.innerHTML = `
    <div class="notification-toast-icon">🔔</div>
    <div class="notification-toast-msg">${message}</div>
  `;
  document.body.appendChild(toast);

  // 브라우저 리플로우 강제 후 표시 애니메이션
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // 4초 후 제거
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 500);
  }, 4000);

  // 클릭 시 해당 페이지로 이동 기능 (옵션)
  toast.onclick = () => {
    toast.remove();
  };
}

/**
 * 실시간 알림 시스템 초기화
 * @param {Function} onNewRecord - 새 기록이 실시간으로 추가될 때 실행할 페이지별 콜백 (학생 목록 갱신 등)
 */
export async function initRealtimeNotifications(onNewRecord = null) {
  console.log("📡 [Global] 실시간 알림 시스템 초기화 시작...");
  
  const currentEmail = getCurrentTeacherEmail();
  if (!currentEmail) {
    console.error("❌ [알림] 로그인 정보(이메일)가 없어 초기화에 실패했습니다.");
    return;
  }

  // 1. 브라우저 알림 권한 상태 로깅만 유지 (자동 요청 제거)
  if ('Notification' in window) {
    console.log("🔔 [알림] 현재 브라우저 권한 상태:", Notification.permission);
  }

  // 실시간(WebSocket) 알림은 별도 anon 키가 설정된 경우에만 동작합니다.
  // (API 게이트웨이는 WebSocket을 프록시하지 못하므로 Supabase에 직접 연결)
  if (!supabaseRealtime) {
    console.warn("📡 [알림] 실시간 채널이 구성되지 않아 알림을 건너뜁니다. (VITE_REALTIME_ANON_KEY 미설정)");
    return null;
  }

  // 채널 구독
  const channel = supabaseRealtime
    .channel('public:life_records-global')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'life_records' }, async (payload) => {
      try {
        console.log("🔍 [알림] 새 DB INSERT 이벤트 감지:", payload.new);
        const newRecord = payload.new;
        
        // 2. 프로필 정보 캐싱 처리 (매번 DB 조회 방지)
        if (!cachedTeacherProfile) {
          console.log("👤 [알림] 교사 프로필을 새로 가져옵니다...");
          cachedTeacherProfile = await getTeacherProfile(currentEmail);
        }
        const teacherProfile = cachedTeacherProfile;
        const settings = teacherProfile?.settings || { notification_type: 'none' };
        
        // 알림 설정이 'none'이면 중단
        if (settings.notification_type === 'none') {
          console.log("🚫 [알림] 알림 설정이 '받지 않음' 상태이므로 건너뜁니다.");
          return;
        }

        // 3. 학생 정보 조회
        console.log(`👨‍🎓 [알림] 학생 정보 조회 시도 (PID: ${newRecord.student_pid})...`);
        const { data: studentInfo } = await supabase
          .from('students')
          .select('name, class_info, pid')
          .eq('pid', newRecord.student_pid)
          .single();
        
        if (!studentInfo) {
          console.warn("⚠️ [알림] 학생 정보를 찾을 수 없습니다.");
          return;
        }

        // "우리반만" 설정 필터링
        if (settings.notification_type === 'my_class' && teacherProfile.assigned_class !== studentInfo.class_info) {
          console.log(`🚫 [알림] 타 학급(${studentInfo.class_info}) 학생의 기록입니다.`);
          return;
        }

        // 4. 메시지 구성
        let teacherName = newRecord.teacher_email_prefix;
        if (teacherName === 'assari') teacherName = '최지은';
        else if (teacherName === 'keeper') teacherName = '배움터지킴이';

        const cat = newRecord.category || "기록";
        const toastMsg = `${studentInfo.class_info} ${studentInfo.name}: [${cat}] 등록 (${teacherName})`;
        
        // 5. 시각적/진동 피드백
        
        // 5-1. 인앱 토스트 표시 (포그라운드 상태 확실한 피드백)
        showInAppToast(toastMsg);

        // 5-2. 모바일 진동
        console.log("震 [알림] 진동 피드백을 실행합니다.");
        if ('vibrate' in navigator) {
          navigator.vibrate([200, 100, 200, 100, 200]); 
        }

        // 6. 네이티브 브라우저 알림 발송 (OS 설정에 따름)
        if ('Notification' in window && Notification.permission === 'granted') {
          const options = {
            body: toastMsg,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag: 'new-record-' + newRecord.id, // 중복 방지 태그
            renotify: true,
            vibrate: [200, 100, 200, 100, 200],
            silent: false,
            data: {
              url: `stu-list.html?grade=${studentInfo.class_info.split('-')[0]}&class=${studentInfo.class_info.split('-')[1]}`
            }
          };

          console.log("🚀 [알림] 기기 네이티브 알림 발송 시도 중...");

          // Service Worker를 통한 알림 우선 시도 (모바일 필수)
          let sentViaSW = false;
          if ('serviceWorker' in navigator) {
            try {
              const registration = await navigator.serviceWorker.ready;
              if (registration && registration.showNotification) {
                console.log("✅ [알림] Service Worker.showNotification 호출 준비 완료.");
                await registration.showNotification('OneClass 신규 기록', options);
                console.log("✅ [알림] 기기 알림 발송 명령이 성공적으로 전달되었습니다.");
                sentViaSW = true;
              }
            } catch (swErr) {
               console.warn("⚠️ [알림] SW 발송 오류:", swErr);
            }
          } 
          
          if (!sentViaSW) {
            try {
              console.log("✅ [알림] Notification API 직접 호출 (PC용 Fallback).");
              const n = new Notification('OneClass 신규 기록', options);
              n.onclick = () => {
                window.focus();
                window.location.href = options.data.url;
              };
            } catch (fallbackErr) {
              console.warn("🚫 [알림] Notification 직접 호출 실패 (모바일 제약일 수 있음):", fallbackErr);
            }
          }
        } else {
          console.warn("🚫 [알림] 알림 권한이 없어 기기에 표시되지 않습니다.");
        }

        // 7. 페이지별 콜백 실행 (목록 갱신 등)
        if (onNewRecord) {
          console.log("🔄 [알림] 페이지 콜백(onNewRecord)을 실행합니다.");
          onNewRecord(newRecord, studentInfo);
        }
      } catch (err) {
        console.error("❌ [알림] 처리 중 예외 발생:", err);
      }
    })
    .subscribe((status) => {
      console.log(`📡 [알림] 실시간 채널 구독 상태 변경: ${status}`);
    });

  return channel;
}
