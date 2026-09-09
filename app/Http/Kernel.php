<?php

namespace App\Http;

use Illuminate\Foundation\Http\Kernel as HttpKernel;

class Kernel extends HttpKernel
{
    protected $middleware = [
        \App\Http\Middleware\PreventRequestsDuringMaintenance::class,
        \Illuminate\Foundation\Http\Middleware\ValidatePostSize::class,
        \App\Http\Middleware\TrimStrings::class,
        \Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull::class,
        \Illuminate\Http\Middleware\HandleCors::class,
        \App\Http\Middleware\MaintenanceMode::class,
    ];

    protected $middlewareGroups = [
        'web' => [
            // ✅ จำเป็นสำหรับ Google Login / Popup / postMessage
            \App\Http\Middleware\AllowGooglePopups::class,
        ],

        'api' => [
            \App\Http\Middleware\ForceCorsHeaders::class,
            'throttle:api',
            \Illuminate\Routing\Middleware\SubstituteBindings::class,
            \App\Http\Middleware\AllowCoop::class, // <-- add this line (near top of the group)
        ],
    ];

    protected $routeMiddleware = [
        'auth' => \App\Http\Middleware\Authenticate::class,
        'auth.basic' => \Illuminate\Auth\Middleware\AuthenticateWithBasicAuth::class,
        'auth.session' => \Illuminate\Session\Middleware\AuthenticateSession::class,
        'guest' => \App\Http\Middleware\RedirectIfAuthenticated::class,
        'throttle' => \Illuminate\Routing\Middleware\ThrottleRequests::class,
        'verified' => \Illuminate\Auth\Middleware\EnsureEmailIsVerified::class,

        // ✅ เพิ่มอันนี้
        'require.bearer' => \App\Http\Middleware\RequireBearerToken::class,
        'admin' => \App\Http\Middleware\EnsureAdmin::class,
    ];
}
