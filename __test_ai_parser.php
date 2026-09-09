<?php

require __DIR__.'/vendor/autoload.php';

$service = new App\Services\AI\AIService(new App\Services\AI\AIClientFactory([]));
$method = new ReflectionMethod($service, 'parseCreateSubjectCommand');
$method->setAccessible(true);

$result = $method->invoke(
    $service,
    'เพิ่มวิชาเรียน ชื่อวิชา โปรแกรม2 วันจันทร์ วันที่ 10/08/2569 เวลา12.00 - 15.00 ห้อง 102 ภาคเรียนที่ 1ปีการศึกษา พ.ศ. 2569'
);

var_export([
    'ok' => $result['ok'],
    'subject_name' => $result['subject_name'],
    'day_label' => $result['day_label'],
    'day_index' => $result['day_index'],
    'start_time' => $result['start_time'],
    'end_time' => $result['end_time'],
    'room' => $result['room'],
    'date' => $result['date']?->format('Y-m-d'),
    'semester' => $result['semester'],
    'academic_year' => $result['academic_year'],
]);
