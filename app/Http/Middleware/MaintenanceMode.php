<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class MaintenanceMode
{
    /**
     * The legacy admin dashboard stores this setting in admin_settings, so it
     * is the shared source of truth for the legacy and Laravel applications.
     */
    public function handle(Request $request, Closure $next)
    {
        if ($this->isAdminRoute($request) || ! $this->isEnabled()) {
            return $next($request);
        }

        $endAt = $this->maintenanceEndAt();
        $message = 'ระบบกำลังอยู่ระหว่างการซ่อมบำรุง กรุณาลองใหม่อีกครั้งภายหลัง';
        if ($endAt !== '') {
            $message .= ' (คาดว่าจะเปิดใช้งานอีกครั้ง ' . $endAt . ')';
        }

        return response()->json([
            'message' => $message,
            'maintenance' => true,
            'maintenance_end_at' => $endAt,
        ], 503);
    }

    private function isAdminRoute(Request $request): bool
    {
        return $request->is('api/admin') || $request->is('api/admin/*');
    }

    private function isEnabled(): bool
    {
        try {
            if (! Schema::hasTable('admin_settings')) {
                return false;
            }

            return (string) DB::table('admin_settings')
                ->where('setting_key', 'maintenance_mode')
                ->value('setting_value') === '1';
        } catch (\Throwable) {
            // A database outage must not activate maintenance mode by accident.
            return false;
        }
    }

    private function maintenanceEndAt(): string
    {
        try {
            return trim((string) DB::table('admin_settings')
                ->where('setting_key', 'maintenance_end_at')
                ->value('setting_value'));
        } catch (\Throwable) {
            return '';
        }
    }
}
