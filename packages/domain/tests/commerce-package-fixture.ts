export const packagePriceFixture = {
 costVersion:'fixture-cost-v1', saleVersion:'fixture-sale-v1',
 costs:{ imageModel:'fixture-image', imageOutputNano:'600000000', extraReferenceNano:'20000000',
  visionModel:'fixture-vision', visionInputPerMillionNano:'600000000', visionOutputPerMillionNano:'3600000000',
  plannerModel:'fixture-plan', plannerInputPerMillionNano:'600000000', plannerOutputPerMillionNano:'3600000000',
  visionMaxInputTokens:20000, visionMaxOutputTokens:4000, plannerMaxInputTokens:10000, plannerMaxOutputTokens:4000,
  evidence:'Synthetic test profile, not a verified supplier bill' },
 sale:{ markupBps:10000,minimumMinor:50,quoteSeconds:900,settlement:'fixed' as const,refund:'successful_images' as const },
};
