-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Sep 18, 2026 at 05:59 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `db_651998018`
--

-- --------------------------------------------------------

--
-- Table structure for table `audio_summaries`
--

CREATE TABLE `audio_summaries` (
  `id` int(11) NOT NULL,
  `file_id` int(11) NOT NULL,
  `study_log_id` int(11) DEFAULT NULL,
  `status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  `transcript` longtext DEFAULT NULL,
  `summary` longtext DEFAULT NULL,
  `ai_model` varchar(100) DEFAULT NULL,
  `error_message` text DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `audio_summaries_v2`
--

CREATE TABLE `audio_summaries_v2` (
  `id` int(11) NOT NULL,
  `job_id` int(11) NOT NULL,
  `summary_type` varchar(255) NOT NULL DEFAULT 'medium',
  `prompt` text DEFAULT NULL,
  `summary_text` longtext NOT NULL,
  `provider` varchar(50) DEFAULT NULL,
  `model` varchar(100) DEFAULT NULL,
  `prompt_tokens` int(11) DEFAULT NULL,
  `completion_tokens` int(11) DEFAULT NULL,
  `status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'completed',
  `error_message` text DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `audio_transcription_jobs`
--

CREATE TABLE `audio_transcription_jobs` (
  `id` int(11) NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `file_id` int(11) NOT NULL,
  `study_log_id` int(11) DEFAULT NULL,
  `status` enum('queued','processing','completed','failed') NOT NULL DEFAULT 'queued',
  `language` varchar(32) DEFAULT NULL,
  `diarization` int(11) NOT NULL DEFAULT 0,
  `speaker_count` int(11) DEFAULT NULL,
  `provider` varchar(50) DEFAULT NULL,
  `model` varchar(100) DEFAULT NULL,
  `duration_seconds` int(11) DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `error_message` varchar(255) DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `audio_transcription_segments`
--

CREATE TABLE `audio_transcription_segments` (
  `id` int(11) NOT NULL,
  `job_id` int(11) NOT NULL,
  `seq` int(11) NOT NULL,
  `start_ms` int(11) DEFAULT NULL,
  `end_ms` int(11) DEFAULT NULL,
  `speaker` varchar(50) DEFAULT NULL,
  `text` text NOT NULL,
  `confidence` int(11) DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `calendar_notes`
--

CREATE TABLE `calendar_notes` (
  `id` int(11) NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `note_date` datetime NOT NULL,
  `note_time` datetime DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `career_paths`
--

CREATE TABLE `career_paths` (
  `id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `career_paths`
--



-- --------------------------------------------------------

--
-- Table structure for table `career_recommendations`
--

CREATE TABLE `career_recommendations` (
  `id` int(11) NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `subject_id` int(11) DEFAULT NULL,
  `career_path_id` int(11) NOT NULL,
  `score` int(11) DEFAULT NULL,
  `reason` text DEFAULT NULL,
  `metadata` text DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `career_recommendations`
--



-- --------------------------------------------------------

--
-- Table structure for table `chat_history`
--

CREATE TABLE `chat_history` (
  `id` int(11) NOT NULL,
  `user_id` varchar(50) NOT NULL,
  `room_id` varchar(50) DEFAULT 'default',
  `sender_type` varchar(20) NOT NULL,
  `message` text DEFAULT NULL,
  `attachment_url` varchar(255) DEFAULT NULL,
  `is_deleted` tinyint(1) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `chat_history`
--



-- --------------------------------------------------------

--
-- Table structure for table `email_provider_accounts`
--

CREATE TABLE `email_provider_accounts` (
  `id` int(11) NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `provider` varchar(255) NOT NULL DEFAULT 'gmail',
  `auth_type` varchar(255) NOT NULL DEFAULT 'oauth',
  `provider_email` varchar(255) NOT NULL,
  `access_token` varchar(255) DEFAULT NULL,
  `refresh_token` varchar(255) DEFAULT NULL,
  `token_expires_at` datetime DEFAULT NULL,
  `scopes` varchar(255) DEFAULT NULL,
  `smtp_host` varchar(255) DEFAULT NULL,
  `smtp_port` int(11) DEFAULT NULL,
  `smtp_username` varchar(255) DEFAULT NULL,
  `smtp_password` varchar(255) DEFAULT NULL,
  `status` varchar(255) NOT NULL DEFAULT 'active',
  `last_error` varchar(255) DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `failed_jobs`
--

CREATE TABLE `failed_jobs` (
  `id` int(11) NOT NULL,
  `uuid` varchar(255) NOT NULL,
  `connection` varchar(255) NOT NULL,
  `queue` varchar(255) NOT NULL,
  `payload` longtext NOT NULL,
  `exception` longtext NOT NULL,
  `failed_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `files`
--

CREATE TABLE `files` (
  `id` int(11) NOT NULL,
  `study_log_id` int(11) DEFAULT NULL,
  `original_name` varchar(255) NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `file_type` enum('pdf','word','audio','image','other') NOT NULL,
  `mime_type` varchar(255) DEFAULT NULL,
  `file_size` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `files`
--



-- --------------------------------------------------------

--
-- Table structure for table `learning_goal_targets`
--

CREATE TABLE `learning_goal_targets` (
  `id` int(11) NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `subject_id` int(11) DEFAULT NULL,
  `schedule_id` int(11) DEFAULT NULL,
  `period_type` enum('daily','weekly','monthly') NOT NULL,
  `quest_type` varchar(50) NOT NULL,
  `title` varchar(255) DEFAULT NULL,
  `target_value` int(11) NOT NULL,
  `current_value` int(11) DEFAULT 0,
  `reward_points` int(11) DEFAULT 10,
  `status` enum('pending','completed','failed') DEFAULT 'pending',
  `period_start` datetime NOT NULL,
  `period_end` datetime NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `learning_notifications`
--

CREATE TABLE `learning_notifications` (
  `id` int(11) NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `subject_id` int(11) DEFAULT NULL,
  `study_log_id` int(11) DEFAULT NULL,
  `calendar_event_id` int(11) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `body` varchar(255) DEFAULT NULL,
  `notify_at` datetime NOT NULL,
  `delivered_at` datetime DEFAULT NULL,
  `channel` varchar(255) NOT NULL DEFAULT 'in_app',
  `status` varchar(255) NOT NULL DEFAULT 'pending',
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `learning_notifications`
--



-- --------------------------------------------------------

--
-- Table structure for table `lessons`
--

CREATE TABLE `lessons` (
  `id` int(11) NOT NULL,
  `subject_id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `content` longtext NOT NULL,
  `summary` longtext DEFAULT NULL,
  `order` int(11) NOT NULL DEFAULT 0,
  `video_url` varchar(255) DEFAULT NULL,
  `audio_notes` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `lesson_summaries`
--

CREATE TABLE `lesson_summaries` (
  `id` int(11) NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `subject_id` int(11) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `summary_type` varchar(255) NOT NULL DEFAULT 'topic',
  `date_from` datetime DEFAULT NULL,
  `date_to` datetime DEFAULT NULL,
  `source_study_log_ids` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `content` longtext NOT NULL,
  `ai_model` varchar(100) DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `migrations`
--

CREATE TABLE `migrations` (
  `id` int(11) NOT NULL,
  `migration` varchar(255) NOT NULL,
  `batch` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `migrations`
--

INSERT INTO `migrations` (`id`, `migration`, `batch`) VALUES
(2, '2025_09_29_060510_create_personal_access_tokens_table', 1),
(3, '2025_09_29_060520_create_password_reset_tokens_table', 1),
(4, '2025_09_29_060530_create_failed_jobs_table', 1),
(5, '2025_09_29_060536_create_files_table', 1),
(6, '2025_09_29_060536_create_quiz_answers_table', 1),
(7, '2025_09_29_060536_create_quiz_questions_table', 1),
(8, '2025_09_29_060536_create_quiz_table', 1),
(9, '2025_09_29_060536_create_study_logs_table', 1),
(10, '2025_09_29_060536_create_subjects_table', 1),
(11, '2025_09_29_060536_create_summaries_table', 1),
(12, '2025_09_29_060500_create_users_table', 2),
(13, 'YYYY_MM_DD_add_password_to_users_table', 3),
(14, 'YYYY_MM_DD_add_provider_columns_to_users_table', 3),
(15, '2025_11_08_000001_add_missing_auth_columns_to_users_table', 4),
(16, '2024_01_01_000001_create_subjects_table', 5),
(17, '2024_01_01_000002_create_lessons_table', 5),
(18, '2024_01_01_000003_create_schedules_table', 5),
(19, '2024_01_01_000004_create_notifications_table', 5),
(20, '2024_01_01_000005_create_quizzes_table', 5),
(21, '2024_01_01_000006_create_mood_tracking_table', 5),
(22, '2024_01_01_000007_create_study_environments_table', 5),
(23, '2024_01_01_000008_update_quiz_questions_table', 5),
(24, '2024_01_01_000009_create_quiz_answers_table', 5),
(25, '2025_12_19_000001_create_study_calendar_events_table', 5),
(26, '2025_12_19_000002_create_learning_notifications_table', 5),
(27, '2025_12_19_000003_create_notification_email_settings_table', 5),
(28, '2025_12_19_000004_create_notification_email_logs_table', 5),
(29, '2025_12_19_000005_create_learning_goal_targets_table', 5),
(30, '2025_09_29_060537_create_study_logs_table', 6),
(31, '2025_09_29_060538_create_quiz_table', 6),
(32, '2025_09_29_060539_create_quiz_questions_table', 6),
(33, '2025_09_29_060540_create_quiz_answers_table', 6),
(34, '2025_09_29_060541_create_summaries_table', 6),
(35, '2025_09_29_060542_create_files_table', 6),
(36, '2026_01_01_000000_fix_auto_increment_tokens_and_notifications', 6),
(37, '2026_01_01_000001_create_email_provider_accounts_table', 6),
(38, '2026_01_17_000002_add_user_id_to_study_logs_table', 6),
(39, '2026_01_17_000003_add_schedule_time_to_subjects_table', 6),
(40, '2026_01_17_104146_update_study_logs_subject_fk_on_delete_cascade', 6),
(41, '2026_01_18_000001_fix_users_table_for_google_login', 6),
(42, '2026_01_29_000001_create_subjects_archives_table', 6),
(43, '2026_01_29_000002_add_event_type_schedule_type_role_columns', 6),
(44, '2026_02_02_145550_add_google_id_to_users_table', 6),
(45, '2026_02_02_145738_add_google_id_and_role_to_users_table', 6),
(46, '2026_02_03_000001_fix_personal_access_tokens_auto_increment', 6),
(47, '2026_02_03_144612_add_google_fields_to_users', 6),
(48, '2026_02_04_120000_add_semester_id_to_subjects_table', 6),
(49, '2026_02_10_000001_fix_notification_email_logs_auto_increment', 6),
(50, '2026_02_10_000003_fix_missing_auto_increment_ids', 7),
(51, '2026_02_12_000001_create_career_paths_table', 8),
(52, '2026_02_12_000002_create_career_recommendations_table', 8),
(53, '2026_02_12_000003_create_quiz_attempts_table', 9),
(54, '2026_03_22_071500_expand_audio_summary_text_columns', 10),
(55, '2026_04_29_165016_add_image_to_files_file_type_enum', 10),
(56, '2026_04_29_173500_add_log_type_to_study_logs_table', 10),
(57, '2026_05_04_140000_expand_career_recommendations_text_columns', 10);

-- --------------------------------------------------------

--
-- Table structure for table `mood_logs`
--

CREATE TABLE `mood_logs` (
  `id` int(11) NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `subject_id` int(11) DEFAULT NULL,
  `mood` varchar(255) NOT NULL,
  `energy_level` int(11) NOT NULL DEFAULT 5,
  `focus_level` int(11) NOT NULL DEFAULT 5,
  `notes` varchar(255) DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `notification_email_settings`
--

CREATE TABLE `notification_email_settings` (
  `id` int(11) NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `email_enabled` int(11) NOT NULL DEFAULT 1,
  `email_address` varchar(255) DEFAULT NULL,
  `digest_type` varchar(255) NOT NULL DEFAULT 'daily',
  `days_ahead` int(11) NOT NULL DEFAULT 1,
  `send_time` datetime NOT NULL DEFAULT '2020-01-01 00:00:00',
  `timezone` varchar(64) NOT NULL DEFAULT 'Asia/Bangkok',
  `last_sent_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `notification_email_settings`
--



-- --------------------------------------------------------

--
-- Table structure for table `password_reset_tokens`
--

CREATE TABLE `password_reset_tokens` (
  `email` varchar(255) NOT NULL,
  `token` varchar(255) NOT NULL,
  `created_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `personal_access_tokens`
--

CREATE TABLE `personal_access_tokens` (
  `id` int(11) NOT NULL,
  `tokenable_type` varchar(255) NOT NULL,
  `tokenable_id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `token` varchar(64) NOT NULL,
  `abilities` varchar(255) DEFAULT NULL,
  `last_used_at` datetime DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `personal_access_tokens`
--



-- --------------------------------------------------------

--
-- Table structure for table `quizzes`
--

CREATE TABLE `quizzes` (
  `id` int(11) NOT NULL,
  `subject_id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `ai_model` varchar(100) DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `quizzes`
--



-- --------------------------------------------------------

--
-- Table structure for table `quiz_answers`
--

CREATE TABLE `quiz_answers` (
  `id` int(11) NOT NULL,
  `question_id` int(11) NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `selected_answer` varchar(255) DEFAULT NULL,
  `is_correct` int(11) NOT NULL DEFAULT 0,
  `score` int(11) NOT NULL DEFAULT 0,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `answered_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `quiz_answers`
--



-- --------------------------------------------------------

--
-- Table structure for table `quiz_attempts`
--

CREATE TABLE `quiz_attempts` (
  `id` int(11) NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `quiz_id` int(11) NOT NULL,
  `answers` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `score` int(11) NOT NULL,
  `passed` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `quiz_attempts`
--



-- --------------------------------------------------------

--
-- Table structure for table `quiz_questions`
--

CREATE TABLE `quiz_questions` (
  `id` int(11) NOT NULL,
  `quiz_id` int(11) NOT NULL,
  `question_text` text NOT NULL,
  `question_type` varchar(255) NOT NULL DEFAULT 'multiple_choice',
  `options` longtext DEFAULT NULL,
  `correct_answer` text DEFAULT NULL,
  `points` int(11) NOT NULL DEFAULT 1,
  `explanation` text DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `quiz_questions`
--



-- --------------------------------------------------------

--
-- Table structure for table `schedules`
--

CREATE TABLE `schedules` (
  `id` int(11) NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `subject_id` int(11) NOT NULL,
  `day_of_week` varchar(255) NOT NULL,
  `start_time` datetime NOT NULL,
  `end_time` datetime NOT NULL,
  `room` varchar(255) DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `schedule_type` varchar(255) NOT NULL DEFAULT 'class'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `schedules`
--



-- --------------------------------------------------------

--
-- Table structure for table `semester`
--

CREATE TABLE `semester` (
  `semester_id` int(11) NOT NULL,
  `semester` int(11) NOT NULL,
  `academic_year` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `semester`
--

INSERT INTO `semester` (`semester_id`, `semester`, `academic_year`) VALUES
(1, 1, 2568),
(2, 2, 2568),
(3, 1, 2569);

-- --------------------------------------------------------

--
-- Table structure for table `study_calendar_events`
--

CREATE TABLE `study_calendar_events` (
  `id` int(11) NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `subject_id` int(11) DEFAULT NULL,
  `study_log_id` int(11) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `start_time` datetime NOT NULL,
  `end_time` datetime DEFAULT NULL,
  `recurrence_rule` varchar(255) DEFAULT NULL,
  `status` varchar(50) NOT NULL DEFAULT 'planned',
  `metadata` varchar(255) DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `event_type` varchar(255) NOT NULL DEFAULT 'class'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `study_calendar_events`
--



-- --------------------------------------------------------

--
-- Table structure for table `study_logs`
--

CREATE TABLE `study_logs` (
  `id` int(11) NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `subject_id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `note` text DEFAULT NULL,
  `log_date` datetime NOT NULL,
  `duration_minutes` int(11) DEFAULT NULL,
  `mood` varchar(100) DEFAULT NULL,
  `log_type` varchar(50) NOT NULL DEFAULT 'study',
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `study_logs`
--



-- --------------------------------------------------------

--
-- Table structure for table `study_notifications`
--

CREATE TABLE `study_notifications` (
  `id` int(11) NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `subject_id` int(11) DEFAULT NULL,
  `type` varchar(255) NOT NULL,
  `title` varchar(255) NOT NULL,
  `message` varchar(255) NOT NULL,
  `notify_at` datetime NOT NULL,
  `is_read` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `subjects`
--

CREATE TABLE `subjects` (
  `id` int(11) NOT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL DEFAULT 1,
  `semester_id` int(11) DEFAULT NULL,
  `name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `color` varchar(12) DEFAULT NULL,
  `target_hours` int(11) DEFAULT NULL,
  `start_date` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `end_time` time DEFAULT NULL,
  `start_time` time DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `subjects`
--



-- --------------------------------------------------------

--
-- Table structure for table `subjects_archives`
--

CREATE TABLE `subjects_archives` (
  `id` int(11) NOT NULL,
  `original_subject_id` int(11) DEFAULT NULL,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` longtext DEFAULT NULL,
  `source_type` varchar(32) DEFAULT NULL,
  `color` varchar(20) DEFAULT NULL,
  `target_hours` int(11) DEFAULT NULL,
  `start_date` datetime DEFAULT NULL,
  `start_time` datetime DEFAULT NULL,
  `end_time` datetime DEFAULT NULL,
  `archived_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `subjects_archives`
--



-- --------------------------------------------------------

--
-- Table structure for table `summaries`
--

CREATE TABLE `summaries` (
  `id` int(11) NOT NULL,
  `study_log_id` int(11) NOT NULL,
  `content` longtext NOT NULL,
  `ai_model` varchar(100) DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `topic_materials`
--

CREATE TABLE `topic_materials` (
  `id` int(11) NOT NULL,
  `study_log_id` int(11) NOT NULL,
  `source_file_id` int(11) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `type` varchar(255) NOT NULL,
  `content` varchar(255) NOT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` bigint(20) UNSIGNED NOT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) DEFAULT NULL,
  `profile_pic` varchar(255) DEFAULT NULL,
  `education_level` varchar(255) DEFAULT NULL,
  `provider` varchar(255) DEFAULT NULL,
  `provider_id` varchar(255) DEFAULT NULL,
  `email_verified_at` timestamp NULL DEFAULT NULL,
  `remember_token` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  `role` enum('admin','user') NOT NULL DEFAULT 'user'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--



--
-- Indexes for dumped tables
--

--
-- Indexes for table `audio_summaries`
--
ALTER TABLE `audio_summaries`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_audio_summaries_file_id` (`file_id`),
  ADD KEY `idx_audio_summaries_study_log_id` (`study_log_id`);

--
-- Indexes for table `audio_summaries_v2`
--
ALTER TABLE `audio_summaries_v2`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_audio_summaries_v2_job_id` (`job_id`);

--
-- Indexes for table `audio_transcription_jobs`
--
ALTER TABLE `audio_transcription_jobs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_audio_jobs_user_id` (`user_id`),
  ADD KEY `idx_audio_jobs_file_id` (`file_id`),
  ADD KEY `idx_audio_jobs_study_log_id` (`study_log_id`);

--
-- Indexes for table `audio_transcription_segments`
--
ALTER TABLE `audio_transcription_segments`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_audio_segments_job_id` (`job_id`);

--
-- Indexes for table `calendar_notes`
--
ALTER TABLE `calendar_notes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_calendar_notes_user_id` (`user_id`);

--
-- Indexes for table `career_paths`
--
ALTER TABLE `career_paths`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `career_recommendations`
--
ALTER TABLE `career_recommendations`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_career_recs_user_id` (`user_id`),
  ADD KEY `idx_career_recs_subject_id` (`subject_id`),
  ADD KEY `idx_career_recs_path_id` (`career_path_id`);

--
-- Indexes for table `chat_history`
--
ALTER TABLE `chat_history`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `email_provider_accounts`
--
ALTER TABLE `email_provider_accounts`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_email_provider_accounts_user_id` (`user_id`);

--
-- Indexes for table `failed_jobs`
--
ALTER TABLE `failed_jobs`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `files`
--
ALTER TABLE `files`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_files_study_log_id` (`study_log_id`);

--
-- Indexes for table `learning_goal_targets`
--
ALTER TABLE `learning_goal_targets`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_learning_goal_subject` (`subject_id`),
  ADD KEY `fk_learning_goal_schedule` (`schedule_id`),
  ADD KEY `idx_learning_goal_user_id` (`user_id`);

--
-- Indexes for table `learning_notifications`
--
ALTER TABLE `learning_notifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_learning_notifications_user_id` (`user_id`),
  ADD KEY `idx_learning_notifications_subject_id` (`subject_id`),
  ADD KEY `idx_learning_notifications_study_log_id` (`study_log_id`),
  ADD KEY `idx_learning_notifications_event_id` (`calendar_event_id`);

--
-- Indexes for table `lessons`
--
ALTER TABLE `lessons`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_lessons_subject_id` (`subject_id`);

--
-- Indexes for table `lesson_summaries`
--
ALTER TABLE `lesson_summaries`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_lesson_summaries_user_id` (`user_id`),
  ADD KEY `idx_lesson_summaries_subject_id` (`subject_id`);

--
-- Indexes for table `migrations`
--
ALTER TABLE `migrations`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `mood_logs`
--
ALTER TABLE `mood_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_mood_logs_user_id` (`user_id`),
  ADD KEY `idx_mood_logs_subject_id` (`subject_id`);

--
-- Indexes for table `notification_email_settings`
--
ALTER TABLE `notification_email_settings`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_notification_email_settings_user_id` (`user_id`);

--
-- Indexes for table `password_reset_tokens`
--
ALTER TABLE `password_reset_tokens`
  ADD PRIMARY KEY (`email`);

--
-- Indexes for table `personal_access_tokens`
--
ALTER TABLE `personal_access_tokens`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `quizzes`
--
ALTER TABLE `quizzes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_quizzes_subject_id` (`subject_id`);

--
-- Indexes for table `quiz_answers`
--
ALTER TABLE `quiz_answers`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_quiz_answers_question_id` (`question_id`),
  ADD KEY `idx_quiz_answers_user_id` (`user_id`);

--
-- Indexes for table `quiz_attempts`
--
ALTER TABLE `quiz_attempts`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_quiz_attempts_user_id` (`user_id`),
  ADD KEY `idx_quiz_attempts_quiz_id` (`quiz_id`);

--
-- Indexes for table `quiz_questions`
--
ALTER TABLE `quiz_questions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_quiz_questions_quiz_id` (`quiz_id`);

--
-- Indexes for table `schedules`
--
ALTER TABLE `schedules`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_schedules_user_id` (`user_id`),
  ADD KEY `idx_schedules_subject_id` (`subject_id`);

--
-- Indexes for table `semester`
--
ALTER TABLE `semester`
  ADD PRIMARY KEY (`semester_id`);

--
-- Indexes for table `study_calendar_events`
--
ALTER TABLE `study_calendar_events`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_calendar_events_user_id` (`user_id`),
  ADD KEY `idx_calendar_events_subject_id` (`subject_id`),
  ADD KEY `idx_calendar_events_study_log_id` (`study_log_id`);

--
-- Indexes for table `study_logs`
--
ALTER TABLE `study_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `study_logs_log_type_index` (`log_type`),
  ADD KEY `idx_study_logs_user_id` (`user_id`),
  ADD KEY `idx_study_logs_subject_id` (`subject_id`);

--
-- Indexes for table `study_notifications`
--
ALTER TABLE `study_notifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_study_notifications_user_id` (`user_id`),
  ADD KEY `idx_study_notifications_subject_id` (`subject_id`);

--
-- Indexes for table `subjects`
--
ALTER TABLE `subjects`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_subjects_user_id` (`user_id`),
  ADD KEY `idx_subjects_semester_id` (`semester_id`);

--
-- Indexes for table `subjects_archives`
--
ALTER TABLE `subjects_archives`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_subjects_archives_original_subject_id` (`original_subject_id`),
  ADD KEY `idx_subjects_archives_user_id` (`user_id`);

--
-- Indexes for table `summaries`
--
ALTER TABLE `summaries`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_summaries_study_log_id` (`study_log_id`);

--
-- Indexes for table `topic_materials`
--
ALTER TABLE `topic_materials`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_topic_materials_study_log_id` (`study_log_id`),
  ADD KEY `idx_topic_materials_source_file_id` (`source_file_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `users_email_unique` (`email`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `audio_summaries`
--
ALTER TABLE `audio_summaries`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `audio_summaries_v2`
--
ALTER TABLE `audio_summaries_v2`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `audio_transcription_jobs`
--
ALTER TABLE `audio_transcription_jobs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `audio_transcription_segments`
--
ALTER TABLE `audio_transcription_segments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `calendar_notes`
--
ALTER TABLE `calendar_notes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `career_paths`
--
ALTER TABLE `career_paths`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `career_recommendations`
--
ALTER TABLE `career_recommendations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `chat_history`
--
ALTER TABLE `chat_history`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `email_provider_accounts`
--
ALTER TABLE `email_provider_accounts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `failed_jobs`
--
ALTER TABLE `failed_jobs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `files`
--
ALTER TABLE `files`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `learning_goal_targets`
--
ALTER TABLE `learning_goal_targets`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `learning_notifications`
--
ALTER TABLE `learning_notifications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `lessons`
--
ALTER TABLE `lessons`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `lesson_summaries`
--
ALTER TABLE `lesson_summaries`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `migrations`
--
ALTER TABLE `migrations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `mood_logs`
--
ALTER TABLE `mood_logs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `notification_email_settings`
--
ALTER TABLE `notification_email_settings`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `personal_access_tokens`
--
ALTER TABLE `personal_access_tokens`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `quizzes`
--
ALTER TABLE `quizzes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `quiz_answers`
--
ALTER TABLE `quiz_answers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `quiz_attempts`
--
ALTER TABLE `quiz_attempts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `quiz_questions`
--
ALTER TABLE `quiz_questions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `schedules`
--
ALTER TABLE `schedules`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `semester`
--
ALTER TABLE `semester`
  MODIFY `semester_id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `study_calendar_events`
--
ALTER TABLE `study_calendar_events`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `study_logs`
--
ALTER TABLE `study_logs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `study_notifications`
--
ALTER TABLE `study_notifications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `subjects`
--
ALTER TABLE `subjects`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `subjects_archives`
--
ALTER TABLE `subjects_archives`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `topic_materials`
--
ALTER TABLE `topic_materials`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `audio_summaries`
--
ALTER TABLE `audio_summaries`
  ADD CONSTRAINT `fk_audio_summaries_file` FOREIGN KEY (`file_id`) REFERENCES `files` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_audio_summaries_study_log` FOREIGN KEY (`study_log_id`) REFERENCES `study_logs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
-- Constraints for table `audio_summaries_v2`
--
ALTER TABLE `audio_summaries_v2`
  ADD CONSTRAINT `fk_audio_summaries_v2_job` FOREIGN KEY (`job_id`) REFERENCES `audio_transcription_jobs` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `audio_transcription_jobs`
--
ALTER TABLE `audio_transcription_jobs`
  ADD CONSTRAINT `fk_audio_jobs_file` FOREIGN KEY (`file_id`) REFERENCES `files` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_audio_jobs_study_log` FOREIGN KEY (`study_log_id`) REFERENCES `study_logs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_audio_jobs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `audio_transcription_segments`
--
ALTER TABLE `audio_transcription_segments`
  ADD CONSTRAINT `fk_audio_segments_job` FOREIGN KEY (`job_id`) REFERENCES `audio_transcription_jobs` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `calendar_notes`
--
ALTER TABLE `calendar_notes`
  ADD CONSTRAINT `fk_calendar_notes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `career_recommendations`
--
ALTER TABLE `career_recommendations`
  ADD CONSTRAINT `fk_career_recs_path` FOREIGN KEY (`career_path_id`) REFERENCES `career_paths` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_career_recs_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_career_recs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `email_provider_accounts`
--
ALTER TABLE `email_provider_accounts`
  ADD CONSTRAINT `fk_email_provider_accounts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `files`
--
ALTER TABLE `files`
  ADD CONSTRAINT `fk_files_study_log` FOREIGN KEY (`study_log_id`) REFERENCES `study_logs` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `learning_goal_targets`
--
ALTER TABLE `learning_goal_targets`
  ADD CONSTRAINT `fk_learning_goal_schedule` FOREIGN KEY (`schedule_id`) REFERENCES `schedules` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_learning_goal_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_learning_goal_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `learning_notifications`
--
ALTER TABLE `learning_notifications`
  ADD CONSTRAINT `fk_learning_notifications_event` FOREIGN KEY (`calendar_event_id`) REFERENCES `study_calendar_events` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_learning_notifications_study_log` FOREIGN KEY (`study_log_id`) REFERENCES `study_logs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_learning_notifications_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_learning_notifications_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `lessons`
--
ALTER TABLE `lessons`
  ADD CONSTRAINT `fk_lessons_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `lesson_summaries`
--
ALTER TABLE `lesson_summaries`
  ADD CONSTRAINT `fk_lesson_summaries_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_lesson_summaries_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `mood_logs`
--
ALTER TABLE `mood_logs`
  ADD CONSTRAINT `fk_mood_logs_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_mood_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `notification_email_settings`
--
ALTER TABLE `notification_email_settings`
  ADD CONSTRAINT `fk_notification_email_settings_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `quizzes`
--
ALTER TABLE `quizzes`
  ADD CONSTRAINT `fk_quizzes_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `quiz_answers`
--
ALTER TABLE `quiz_answers`
  ADD CONSTRAINT `fk_quiz_answers_question` FOREIGN KEY (`question_id`) REFERENCES `quiz_questions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_quiz_answers_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `quiz_attempts`
--
ALTER TABLE `quiz_attempts`
  ADD CONSTRAINT `fk_quiz_attempts_quiz` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_quiz_attempts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `quiz_questions`
--
ALTER TABLE `quiz_questions`
  ADD CONSTRAINT `fk_quiz_questions_quiz` FOREIGN KEY (`quiz_id`) REFERENCES `quizzes` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `schedules`
--
ALTER TABLE `schedules`
  ADD CONSTRAINT `fk_schedules_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_schedules_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `study_calendar_events`
--
ALTER TABLE `study_calendar_events`
  ADD CONSTRAINT `fk_calendar_events_study_log` FOREIGN KEY (`study_log_id`) REFERENCES `study_logs` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_calendar_events_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_calendar_events_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `study_logs`
--
ALTER TABLE `study_logs`
  ADD CONSTRAINT `fk_study_logs_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_study_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `study_notifications`
--
ALTER TABLE `study_notifications`
  ADD CONSTRAINT `fk_study_notifications_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_study_notifications_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `subjects`
--
ALTER TABLE `subjects`
  ADD CONSTRAINT `fk_subjects_semester` FOREIGN KEY (`semester_id`) REFERENCES `semester` (`semester_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_subjects_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `subjects_archives`
--
ALTER TABLE `subjects_archives`
  ADD CONSTRAINT `fk_subjects_archives_original_subject` FOREIGN KEY (`original_subject_id`) REFERENCES `subjects` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_subjects_archives_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `summaries`
--
ALTER TABLE `summaries`
  ADD CONSTRAINT `fk_summaries_study_log` FOREIGN KEY (`study_log_id`) REFERENCES `study_logs` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `topic_materials`
--
ALTER TABLE `topic_materials`
  ADD CONSTRAINT `fk_topic_materials_source_file` FOREIGN KEY (`source_file_id`) REFERENCES `files` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_topic_materials_study_log` FOREIGN KEY (`study_log_id`) REFERENCES `study_logs` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
--
-- Per-user semester membership, matching the Laravel migration.
--
CREATE TABLE IF NOT EXISTS `user_semesters` (
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `semester_id` int(10) UNSIGNED NOT NULL,
  PRIMARY KEY (`user_id`, `semester_id`),
  KEY `user_semesters_semester_id_index` (`semester_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;



--
-- Table structure for table `goal_tasks`
--
CREATE TABLE `goal_tasks` (
  `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) UNSIGNED NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `task_date` date NOT NULL,
  `start_time` time DEFAULT NULL,
  `end_time` time DEFAULT NULL,
  `completed` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `goal_tasks_user_id_task_date_index` (`user_id`, `task_date`)
) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
