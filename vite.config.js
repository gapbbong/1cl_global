import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        student: resolve(__dirname, 'stu-list.html'),
        record: resolve(__dirname, 'record.html'),
        search: resolve(__dirname, 'search.html'),
        bulk: resolve(__dirname, 'bulk-record.html'),
        total: resolve(__dirname, 'total-records.html'),
        survey: resolve(__dirname, 'class-survey.html'),
        check_survey: resolve(__dirname, 'check-survey.html'),
        analysis: resolve(__dirname, 'analysis.html'),
        class_analysis: resolve(__dirname, 'class-analysis.html'),
        keeper: resolve(__dirname, 'keeper.html'),
        quiz: resolve(__dirname, 'quiz.html'),
        quiz_start: resolve(__dirname, 'quiz-start.html'),
        index_2025: resolve(__dirname, 'index-2025.html'),
        photo_quiz: resolve(__dirname, 'photo-quiz.html'),
        quiz_photo: resolve(__dirname, 'quiz-photo.html'),
        random_photo: resolve(__dirname, 'random-photo.html'),
        show_one_photo: resolve(__dirname, 'show-one-photo.html'),
        select_range: resolve(__dirname, 'select-range.html'),
        admin: resolve(__dirname, 'admin.html'),
        admin_console: resolve(__dirname, 'admin-console.html'),
        survey_form: resolve(__dirname, 'survey-form.html'),
        calendar: resolve(__dirname, 'calendar.html'),
        room_search: resolve(__dirname, 'room-search.html'),
        print_report: resolve(__dirname, 'print-report.html'),
        settings: resolve(__dirname, 'settings.html'),
        map: resolve(__dirname, 'map-3d.html')
      }
    }
  },
  server: {
    host: '127.0.0.1', // 로컬 접속 전용 (외부 침입 방지)
    open: true,
    // 로컬 개발: /api 를 dev-gateway(scripts/dev-gateway.mjs, :8787)로 프록시.
    // 프로덕션은 Netlify edge/lambda 가 /api 를 서빙하므로 이 설정은 dev 전용.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.GH_DEV_GATEWAY_PORT || 8787}`,
        changeOrigin: true,
      },
    },
  }
});
