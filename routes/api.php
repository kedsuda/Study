<?php

use App\Http\Controllers\API\AIController;
use App\Http\Controllers\API\AuthController;
use App\Http\Controllers\API\AssistantChatController;
use App\Http\Controllers\API\CareerAdvisorController;
use App\Http\Controllers\API\DashboardController;
use App\Http\Controllers\API\FileController;
use App\Http\Controllers\API\GmailController;
use App\Http\Controllers\API\GoalController;
use App\Http\Controllers\API\LearningStatsController;
use App\Http\Controllers\API\QuizController;
use App\Http\Controllers\API\SemesterController;
use App\Http\Controllers\API\StudyCalendarEventController;
use App\Http\Controllers\API\StudyLogController;
use App\Http\Controllers\API\SubjectController;
use App\Http\Controllers\API\SubjectArchiveController;
use App\Http\Controllers\API\SummaryController;
use App\Http\Controllers\API\PortfolioController;
use App\Http\Controllers\NotificationController as NotificationController;
use Illuminate\Support\Facades\Route;


Route::post('/auth/google', [AuthController::class, 'googleSignIn']);
Route::get('/auth/google/callback', [AuthController::class, 'googleCallback']);
Route::post('/register', [AuthController::class, 'register']);
Route::post('/auth/register', [AuthController::class, 'register']);
Route::post('/auth/login', [AuthController::class, 'login']);
Route::get('/auth/google-config', [AuthController::class, 'googleConfig']);
Route::post('/auth/dev-login', [AuthController::class, 'devLogin']);
Route::get('/gmail/callback', [GmailController::class, 'callback']);

Route::middleware('auth:sanctum')->group(function () {

    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::put('/auth/profile', [AuthController::class, 'updateProfile']);
    // รองรับโฮสต์ที่ไม่อนุญาต HTTP PUT จากหน้าเว็บ
    Route::post('/auth/profile', [AuthController::class, 'updateProfile']);

    require __DIR__ . '/admin.php';


    Route::get('/dashboard/overview', [DashboardController::class, 'overview']);
    Route::get('/dashboard/progress', [DashboardController::class, 'progress']);

    Route::get('/semesters', [SemesterController::class, 'index']);
    Route::post('/semesters', [SemesterController::class, 'store']);

    // --------------------------
    // Subjects
    // --------------------------

    // CRUD หลัก
Route::get('/subjects', [SubjectController::class, 'index']);
Route::post('/subjects', [SubjectController::class, 'store']);

    // ทุก route ที่มี {subject} ให้รับเฉพาะตัวเลข
Route::get('/subjects/{subject}', [SubjectController::class, 'show'])->whereNumber('subject');
Route::match(['put', 'patch'], '/subjects/{subject}', [SubjectController::class, 'update'])->whereNumber('subject');
Route::delete('/subjects/{subject}', [SubjectController::class, 'destroy'])->whereNumber('subject');

// รองรับโฮสต์ที่ส่ง PUT/PATCH ไม่ได้: หน้าบ้านจะส่ง POST พร้อมข้อมูลวิชาแทน
Route::post('/subjects/{subject}', [SubjectController::class, 'update'])->whereNumber('subject');
Route::post('/subjects/{subject}/delete', [SubjectController::class, 'destroy'])->whereNumber('subject');
Route::post('/subjects/delete', [SubjectController::class, 'destroyById']);

    // --------------------------
    // Study Logs
    // --------------------------
    Route::get('/subjects/{subject}/study-logs', [StudyLogController::class, 'index'])->whereNumber('subject');
    Route::post('/subjects/{subject}/study-logs', [StudyLogController::class, 'store'])->whereNumber('subject');
    Route::get('/subjects/{subject}/study-logs/{studyLog}', [StudyLogController::class, 'show'])->whereNumber('subject');
    Route::match(['put', 'patch'], '/subjects/{subject}/study-logs/{studyLog}', [StudyLogController::class, 'update'])->whereNumber('subject');
    Route::delete('/subjects/{subject}/study-logs/{studyLog}', [StudyLogController::class, 'destroy'])->whereNumber('subject');

    Route::get('/subjects/{subject}/summary-archives', [SubjectArchiveController::class, 'index'])->whereNumber('subject');
    Route::post('/subjects/{subject}/summary-archives', [SubjectArchiveController::class, 'store'])->whereNumber('subject');
    Route::match(['put', 'patch'], '/subjects/{subject}/summary-archives/{archive}', [SubjectArchiveController::class, 'update'])->whereNumber('subject')->whereNumber('archive');
    Route::delete('/subjects/{subject}/summary-archives/{archive}', [SubjectArchiveController::class, 'destroy'])->whereNumber('subject')->whereNumber('archive');
    Route::get('/summary-archives/count', [SubjectArchiveController::class, 'count']);

    Route::post('/study-logs/{studyLog}/files', [FileController::class, 'store']);
    Route::match(['put', 'patch'], '/files/{file}/status', [FileController::class, 'updateStatus']);
    Route::delete('/files/{file}', [FileController::class, 'destroy']);

    Route::get('/study-logs/{studyLog}/summaries', [SummaryController::class, 'index']);
    Route::post('/study-logs/{studyLog}/summaries', [SummaryController::class, 'generate']);
    Route::delete('/summaries/{summary}', [SummaryController::class, 'destroy']);

    // --------------------------
    // Calendar Events
    // --------------------------
    Route::get('/calendar-events', [StudyCalendarEventController::class, 'index']);
    Route::post('/calendar-events', [StudyCalendarEventController::class, 'store']);
    Route::match(['put', 'patch'], '/calendar-events/{calendar_event}', [StudyCalendarEventController::class, 'update']);
    Route::delete('/calendar-events/{calendar_event}', [StudyCalendarEventController::class, 'destroy']);
    Route::post('/calendar-events/{calendar_event}', [StudyCalendarEventController::class, 'destroy']);
    Route::post('/calendar-events/{calendar_event}/delete', [StudyCalendarEventController::class, 'destroy']);
    Route::post('/calendar-events/delete', [StudyCalendarEventController::class, 'destroyById']);
    Route::post('/calendar-events/clear', [StudyCalendarEventController::class, 'clearAll']);

    // --------------------------
    // Quizzes, Goals, AI, Career, Gmail, Notifications
    // --------------------------
    Route::get('/subjects/{subject}/quizzes', [QuizController::class, 'index'])->whereNumber('subject');
    Route::post('/subjects/{subject}/quizzes', [QuizController::class, 'store'])->whereNumber('subject');
    Route::post('/subjects/{subject}/quizzes/from-file', [QuizController::class, 'storeFromFile'])->whereNumber('subject');
    Route::get('/quizzes/summary', [QuizController::class, 'summary']);
    Route::get('/quizzes/{quiz}', [QuizController::class, 'show']);
    Route::delete('/quizzes/{quiz}', [QuizController::class, 'destroy']);
    Route::post('/quizzes/{quiz}/attempts', [QuizController::class, 'submitAttempt']);

    Route::get('/goals/summary', [GoalController::class, 'summary']);
    Route::post('/goals/targets', [GoalController::class, 'upsertTarget']);
    Route::post('/goals/targets/reset', [GoalController::class, 'resetTarget']);
    Route::get('/learning-stats/summary', [LearningStatsController::class, 'summary']);
    Route::get('/portfolio', [PortfolioController::class, 'show']);
    Route::put('/portfolio', [PortfolioController::class, 'upsert']);
    Route::get('/portfolio/images', [PortfolioController::class, 'images']);
    Route::post('/portfolio/images', [PortfolioController::class, 'uploadImage']);
    Route::put('/portfolio/images/{image}', [PortfolioController::class, 'updateImage']);
    Route::get('/portfolio/image-proxy', [PortfolioController::class, 'imageProxy']);
    Route::post('/portfolio/cover-image', [PortfolioController::class, 'uploadCoverImage']);
    Route::put('/portfolio/images/reorder', [PortfolioController::class, 'reorderImages']);
    Route::delete('/portfolio/images/{image}', [PortfolioController::class, 'deleteImage']);

    Route::post('/ai/transcribe/audio', [AIController::class, 'transcribeAudio']);
    Route::post('/ai/summarize/audio', [AIController::class, 'summarizeAudio']);
    Route::post('/ai/summaries/audio', [AIController::class, 'storeAudioSummary']);
    Route::get('/ai/summaries/audio', [AIController::class, 'audioSummaries']);
    Route::delete('/ai/summaries/audio/{audioSummary}', [AIController::class, 'destroyAudioSummary']);
    Route::post('/ai/analyze/document', [AIController::class, 'extractDocument']);
    Route::post('/ai/summarize/document', [AIController::class, 'summarizeDocument']);
    Route::post('/ai/mindmap', [AIController::class, 'mindMap']);

    Route::post('/career/recommendations', [CareerAdvisorController::class, 'recommendations']);
    Route::post('/career/analyze', [CareerAdvisorController::class, 'analyze']);
    Route::get('/career/insights', [CareerAdvisorController::class, 'insights']);
    Route::get('/assistant/chat/history', [AssistantChatController::class, 'index']);
    Route::post('/assistant/chat/message', [AssistantChatController::class, 'store']);
    Route::delete('/assistant/chat/history', [AssistantChatController::class, 'destroyHistory']);
    Route::post('/assistant/chat/history/delete', [AssistantChatController::class, 'destroyHistory']);
    Route::delete('/assistant/chat/history/{message}', [AssistantChatController::class, 'destroyMessage']);

    Route::get('/gmail/authorize', [GmailController::class, 'authorizeGmail']);
    Route::get('/gmail/status', [GmailController::class, 'status']);

    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::post('/notifications', [NotificationController::class, 'store']);
    Route::get('/notifications/unread', [NotificationController::class, 'unread']);
    Route::post('/notifications/schedule-range', [NotificationController::class, 'createScheduleRange']);
    Route::post('/notifications/schedule', [NotificationController::class, 'createScheduleNotification']);
    Route::get('/notifications/settings', [NotificationController::class, 'settings']);
    Route::put('/notifications/settings', [NotificationController::class, 'updateSettings']);
    Route::patch('/notifications/{notification}/read', [NotificationController::class, 'markAsRead']);
    Route::patch('/notifications/{notification}/delivered', [NotificationController::class, 'markAsDelivered']);
    Route::patch('/notifications/{notification}/time', [NotificationController::class, 'updateTime']);
    Route::post('/notifications/{notification}/read', [NotificationController::class, 'markAsRead']);
    Route::post('/notifications/{notification}/delivered', [NotificationController::class, 'markAsDelivered']);
    Route::post('/notifications/{notification}/time', [NotificationController::class, 'updateTime']);
    Route::delete('/notifications/{notification}', [NotificationController::class, 'destroy']);
    Route::post('/notifications/{notification}', [NotificationController::class, 'destroy']);
    Route::post('/notifications/{notification}/delete', [NotificationController::class, 'destroy']);
});
