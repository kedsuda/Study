<?php

use App\Http\Controllers\API\Admin\AdminController;
use App\Http\Controllers\API\Admin\AdminPingController;
use Illuminate\Support\Facades\Route;

Route::prefix('admin')->middleware('admin')->group(function () {
    Route::get('/ping', AdminPingController::class);
    Route::get('/overview', [AdminController::class, 'overview']);
    Route::get('/users', [AdminController::class, 'users']);
    Route::get('/users/{user}', [AdminController::class, 'user']);
    Route::get('/settings', [AdminController::class, 'settings']);
    Route::put('/settings', [AdminController::class, 'updateSettings']);
});
