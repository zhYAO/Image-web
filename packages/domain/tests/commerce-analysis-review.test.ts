import {it,expect} from 'vitest';
import {assertAnalysisReviewCurrent} from '../src/commerce-analysis';
it('invalidates changed image roles or facts, while generated strategy may change',()=>{
 const review={referenceSignature:'product-a',facts:'白色杯',styleSummary:'暖光'};
 expect(()=>assertAnalysisReviewCurrent(review,'product-b','白色杯')).toThrow();
 expect(()=>assertAnalysisReviewCurrent(review,'product-a','黑色杯')).toThrow();
 expect(()=>assertAnalysisReviewCurrent(review,'product-a','白色杯')).not.toThrow();
 expect(()=>assertAnalysisReviewCurrent(undefined,'manual','用户手填')).not.toThrow();
});
