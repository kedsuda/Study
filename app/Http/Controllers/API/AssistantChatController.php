<?php

namespace App\Http\Controllers\API;

use App\Http\Controllers\Controller;
use App\Models\ChatHistory;
use App\Services\AI\AIService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AssistantChatController extends Controller
{
    private const ASSISTANT_TIMEZONE = 'Asia/Bangkok';

    public function __construct(private readonly AIService $aiService)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'room_id' => ['nullable', 'string', 'max:50'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $roomId = trim((string) ($validated['room_id'] ?? 'default')) ?: 'default';
        $limit = (int) ($validated['limit'] ?? 50);
        $userId = (string) $request->user()->id;

        $messages = ChatHistory::query()
            ->where('user_id', $userId)
            ->where('room_id', $roomId)
            ->where('is_deleted', false)
            ->orderByDesc('id')
            ->limit($limit)
            ->get()
            ->reverse()
            ->values()
            ->map(fn (ChatHistory $message) => $this->transformMessage($message));

        return response()->json([
            'room_id' => $roomId,
            'messages' => $messages,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'room_id' => ['nullable', 'string', 'max:50'],
            'message' => ['required', 'string', 'max:5000'],
            'tool' => ['nullable', 'string', 'max:100'],
            'attachment_url' => ['nullable', 'string', 'max:255'],
        ]);

        $user = $request->user();
        $userId = (string) $user->id;
        $roomId = trim((string) ($validated['room_id'] ?? 'default')) ?: 'default';
        $messageText = trim((string) $validated['message']);
        $tool = trim((string) ($validated['tool'] ?? ''));
        $attachmentUrl = trim((string) ($validated['attachment_url'] ?? ''));

        $userMessage = ChatHistory::query()->create([
            'user_id' => $userId,
            'room_id' => $roomId,
            'sender_type' => 'user',
            'message' => $messageText,
            'attachment_url' => $attachmentUrl !== '' ? $attachmentUrl : null,
            'is_deleted' => false,
            'created_at' => Carbon::now(self::ASSISTANT_TIMEZONE)->format('Y-m-d H:i:s'),
        ]);

        $history = ChatHistory::query()
            ->where('user_id', $userId)
            ->where('room_id', $roomId)
            ->where('is_deleted', false)
            ->orderByDesc('id')
            ->limit(16)
            ->get()
            ->reverse()
            ->values()
            ->map(fn (ChatHistory $message) => [
                'sender_type' => (string) $message->sender_type,
                'message' => (string) ($message->message ?? ''),
            ])
            ->all();

        try {
            $assistantReply = $this->aiService->chatWithAssistant(
                $user,
                $messageText,
                $history,
                $tool !== '' ? $tool : null
            );
        } catch (\Throwable $e) {
            report($e);

            $assistantReply = $this->resolveAssistantFallbackMessage($e);
        }

        $assistantMessage = ChatHistory::query()->create([
            'user_id' => $userId,
            'room_id' => $roomId,
            'sender_type' => 'assistant',
            'message' => $assistantReply,
            'attachment_url' => null,
            'is_deleted' => false,
            'created_at' => Carbon::now(self::ASSISTANT_TIMEZONE)->format('Y-m-d H:i:s'),
        ]);

        $messages = ChatHistory::query()
            ->where('user_id', $userId)
            ->where('room_id', $roomId)
            ->where('is_deleted', false)
            ->orderByDesc('id')
            ->limit(50)
            ->get()
            ->reverse()
            ->values()
            ->map(fn (ChatHistory $message) => $this->transformMessage($message));

        return response()->json([
            'room_id' => $roomId,
            'user_message' => $this->transformMessage($userMessage),
            'assistant_message' => $this->transformMessage($assistantMessage),
            'messages' => $messages,
            // This must reflect a real database write, not wording produced by
            // the language model.
            'schedule_updated' => $this->aiService->assistantScheduleWasUpdated(),
            'subjects_updated' => $this->aiService->assistantSubjectsWereUpdated(),
        ]);
    }

    public function destroyHistory(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'room_id' => ['nullable', 'string', 'max:50'],
        ]);

        $roomId = trim((string) ($validated['room_id'] ?? 'default')) ?: 'default';
        $userId = (string) $request->user()->id;

        $affected = ChatHistory::query()
            ->where('user_id', $userId)
            ->where('room_id', $roomId)
            ->where('is_deleted', false)
            ->update([
                'is_deleted' => true,
            ]);

        return response()->json([
            'room_id' => $roomId,
            'deleted_count' => $affected,
        ]);
    }

    public function destroyMessage(Request $request, ChatHistory $message): JsonResponse
    {
        $userId = (string) $request->user()->id;

        if ((string) $message->user_id !== $userId) {
            return response()->json([
                'message' => 'ไม่พบข้อความที่ต้องการลบ',
            ], 404);
        }

        if ($message->is_deleted) {
            return response()->json([
                'id' => $message->id,
                'deleted' => true,
            ]);
        }

        $message->is_deleted = true;
        $message->save();

        return response()->json([
            'id' => $message->id,
            'deleted' => true,
        ]);
    }

    private function transformMessage(ChatHistory $message): array
    {
        return [
            'id' => $message->id,
            'user_id' => (string) $message->user_id,
            'room_id' => (string) ($message->room_id ?? 'default'),
            'sender_type' => (string) $message->sender_type,
            'message' => (string) ($message->message ?? ''),
            'attachment_url' => $message->attachment_url,
            'is_deleted' => (bool) $message->is_deleted,
            'created_at' => $this->formatMessageCreatedAt($message),
        ];
    }

    private function formatMessageCreatedAt(ChatHistory $message): ?string
    {
        $createdAt = $message->getRawOriginal('created_at');

        if (! $createdAt) {
            return null;
        }

        return Carbon::parse((string) $createdAt, self::ASSISTANT_TIMEZONE)->toIso8601String();
    }

    private function resolveAssistantFallbackMessage(\Throwable $error): string
    {
        $message = trim($error->getMessage());

        if ($message !== '') {
            if (str_contains($message, 'API key is missing') || str_contains($message, 'Groq API key is missing')) {
                return 'ตอนนี้ระบบยังอ่านค่า Groq API key ไม่ได้ จึงตอบกลับไม่สำเร็จค่ะ กรุณาตรวจสอบค่า `GROQ_API_KEY` และรีสตาร์ตเซิร์ฟเวอร์แล้วลองใหม่อีกครั้งค่ะ';
            }

            if (str_contains($message, 'quota') || str_contains($message, 'Quota exceeded') || str_contains($message, 'free_tier_requests')) {
                return 'ตอนนี้ Groq ของระบบใช้โควต้าครบแล้ว จึงยังตอบกลับไม่ได้ชั่วคราว แต่ผมบันทึกข้อความของคุณไว้แล้ว กรุณารอสักครู่หรือเพิ่ม quota/billing แล้วลองส่งใหม่อีกครั้งครับ';
            }

            if (str_contains($message, 'blocked')) {
                return 'ตอนนี้ Groq ของระบบถูกบล็อกการเรียกใช้งานอยู่ จึงยังตอบกลับไม่ได้ชั่วคราว แต่ผมบันทึกข้อความของคุณไว้แล้ว กรุณาตรวจสอบสิทธิ์ API แล้วลองใหม่อีกครั้งครับ';
            }

            if (str_contains($message, 'not found') || str_contains($message, 'not supported for generateContent')) {
                return 'ตอนนี้ Groq ของระบบตั้งค่า model ไม่ตรงกับ endpoint ที่ใช้งาน จึงยังตอบกลับไม่ได้ชั่วคราว แต่ผมบันทึกข้อความของคุณไว้แล้ว กรุณาตรวจสอบ model แล้วลองใหม่อีกครั้งครับ';
            }

            if (str_contains($message, 'disabled') || str_contains($message, 'has not been used in project')) {
                return 'ตอนนี้ Groq API ของระบบยังไม่ได้เปิดใช้งานหรือยังไม่พร้อมใช้งาน จึงยังตอบกลับไม่ได้ชั่วคราว แต่ผมบันทึกข้อความของคุณไว้แล้ว กรุณาเปิด API แล้วลองใหม่อีกครั้งครับ';
            }

            if (str_contains($message, 'cURL error 7') || str_contains($message, 'Failed to connect to generativelanguage.googleapis.com')) {
                return 'ตอนนี้เซิร์ฟเวอร์เชื่อมต่อ Groq API ไม่ได้ (network/firewall) จึงยังตอบกลับไม่ได้ชั่วคราว แต่ผมบันทึกข้อความของคุณไว้แล้ว กรุณาตรวจสอบอินเทอร์เน็ตหรือ firewall ของเซิร์ฟเวอร์ แล้วลองใหม่อีกครั้งครับ';
            }
        }

        return 'ตอนนี้ระบบ AI ตอบกลับไม่ได้ชั่วคราว แต่ผมบันทึกข้อความของคุณไว้แล้ว ลองส่งใหม่อีกครั้งได้เลยครับ';
    }
}
