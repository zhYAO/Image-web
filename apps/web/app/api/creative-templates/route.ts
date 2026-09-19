import { COMMERCE_SCENES, COMMERCE_TEMPLATES } from "@zimage/domain";
export function GET() {
  return Response.json({
    scenes: COMMERCE_SCENES,
    templates: COMMERCE_TEMPLATES.map(
      ({ id, name, version, source, validation, published }) => ({
        id,
        name,
        version,
        source,
        validation,
        published,
      }),
    ),
  });
}
