from pydantic import BaseModel


class ResourceBase(BaseModel):
    name: str
    description: str | None = None
    resource_type: str | None = None


class ResourceCreate(ResourceBase):
    pass


class ResourceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    resource_type: str | None = None


class ResourceRead(ResourceBase):
    id: str


class PlanResourceBase(BaseModel):
    plan_id: str
    resource_id: str
    notes: str | None = None


class PlanResourceCreate(PlanResourceBase):
    pass


class PlanResourceUpdate(BaseModel):
    notes: str | None = None


class PlanResourceRead(PlanResourceBase):
    id: str
    resource_name: str
    resource_type: str | None = None


class FileCategoryRead(BaseModel):
    id: str
    name: str
    description: str | None = None


class StoredFileRead(BaseModel):
    id: str
    category_id: str | None = None
    song_id: str | None = None
    display_name: str
    content_type: str | None = None
    checksum: str | None = None
    flatten_builds: bool = False


class ItemFileCreate(BaseModel):
    file_id: str
    sort_order: int = 0
    persistent: bool = False


class ItemFileUpdate(BaseModel):
    persistent: bool


class ItemFileRead(BaseModel):
    id: str
    plan_item_id: str
    file_id: str
    sort_order: int
    persistent: bool = False
    display_name: str
    content_type: str | None = None


class RenderedSlideRead(BaseModel):
    index: int
    image_url: str
    original_index: int | None = None
    build_index: int = 0
    build_count: int = 1


class BibleVersionRead(BaseModel):
    id: str
    code: str
    name: str
    language: str | None = None
    license: str | None = None


class BibleBookRead(BaseModel):
    id: str
    name: str
    abbreviation: str
    testament: str
    sort_order: int


class BiblePassageRead(BaseModel):
    version: str
    reference: str
    text: str


class BibleSearchHitRead(BaseModel):
    version: str
    reference: str
    text: str
    book: str
    chapter: int
    verse_from: int
    verse_to: int
